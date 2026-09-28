/**
 * Token speed — 在底部状态栏显示模型输出速度与首 token 延迟。
 *
 * 锚点：
 * - turn_start：你发消息、agent 开始处理
 * - 第一个内容增量（text/thinking/toolcall delta）：真正的"第一个 token"
 * - message_end：响应结束
 *
 * 显示：
 * - 等待首 token：`⏳ 1.2s`
 * - 流式输出中：`⚡ ~42 tok/s`（按增量估算，分母从第一个 token 起算）
 * - 结束后：`⚡ 45 tok/s · ttft 1.2s · 3.5s`
 *   tok/s = usage.output ÷ 纯生成时长；ttft = 首 token − turn_start，仅每轮
 *   第一个模型响应显示（后续响应前面隔着工具执行时间，无法干净归因）。
 *
 * 口径说明：usage.output 含 reasoning/thinking token（思考也算输出）。
 *
 * 放在 ~/.pi/agent/extensions/ 下自动加载，改动后用 /reload 热重载。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KEY = "tok-speed";
const LOG = join(homedir(), ".pi", "agent", "token-speed.jsonl");

// 口径：这里的速度是你「实际体验」的值——含服务端停顿，不含工具执行时间
// （因为按每次模型响应计时，工具执行落在响应之间）。
// true = 每次响应结束后在底部保留一行（速度 · 首字等待 · 生成时长）；
// false = 只在流式期间显示，结束即清除。
const SHOW_FINAL_LINE = true;
const UPDATE_INTERVAL_MS = 250;

/** 粗略 token 估算：CJK 字符约 1 字 1 token，其余约 4 字符 1 token */
function estimateTokens(text: string): number {
	let cjk = 0;
	let other = 0;
	for (const ch of text) {
		if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) cjk++;
		else other++;
	}
	return cjk + Math.ceil(other / 4);
}

const fmt = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1));

export default function (pi: ExtensionAPI) {
	let turnStartedAt = 0;
	let firstAssistantOfTurn = false;

	let startedAt = 0; // 当前 assistant 消息的 message_start
	let ttftAnchor = 0; // 本轮 turn_start（仅每轮第一个 assistant 消息有）
	let firstDeltaAt = 0; // 第一个内容增量到达时刻
	let deltaTokens = 0;
	let lastRender = 0;

	pi.on("turn_start", async () => {
		turnStartedAt = Date.now();
		firstAssistantOfTurn = true;
	});

	pi.on("message_start", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		startedAt = Date.now();
		ttftAnchor = firstAssistantOfTurn ? turnStartedAt : 0;
		firstAssistantOfTurn = false;
		firstDeltaAt = 0;
		deltaTokens = 0;
		lastRender = 0;
		ctx.ui.setStatus(KEY, ttftAnchor ? "⏳ …" : "⚡ …");
	});

	pi.on("message_update", async (event, ctx) => {
		if (!startedAt) return;
		const msg = event.message as any;
		if (!msg || msg.role !== "assistant") return;

		const ev = (event as any).assistantMessageEvent;
		if (ev && (ev.type === "text_delta" || ev.type === "thinking_delta" || ev.type === "toolcall_delta")) {
			if (!firstDeltaAt) firstDeltaAt = Date.now();
			deltaTokens += estimateTokens(ev.delta ?? "");
		}

		const now = Date.now();
		if (now - lastRender < UPDATE_INTERVAL_MS) return;
		lastRender = now;

		if (!firstDeltaAt) {
			if (ttftAnchor) ctx.ui.setStatus(KEY, `⏳ ${((now - ttftAnchor) / 1000).toFixed(1)}s`);
			return;
		}
		const gen = (now - firstDeltaAt) / 1000;
		if (gen <= 0) return;
		ctx.ui.setStatus(KEY, `⚡ ~${fmt(deltaTokens / gen)} tok/s`);
	});

	pi.on("message_end", async (event, ctx) => {
		const msg = event.message as any;
		if (!msg || msg.role !== "assistant") return;
		startedAt = 0;

		const output = msg.usage?.output ?? 0;
		if (!firstDeltaAt || output <= 0) {
			ctx.ui.setStatus(KEY, undefined);
			return;
		}

		const gen = (Date.now() - firstDeltaAt) / 1000;
		const ttft = ttftAnchor ? (firstDeltaAt - ttftAnchor) / 1000 : undefined;
		if (gen <= 0.05) {
			ctx.ui.setStatus(KEY, undefined);
			return;
		}

		// 逐次追加记录，便于事后分析平均速度与慢的归因
		try {
			appendFileSync(
				LOG,
				JSON.stringify({
					ts: Date.now(),
					provider: msg.provider,
					model: msg.model,
					ttftSec: ttft !== undefined ? +ttft.toFixed(2) : undefined,
					genSec: +gen.toFixed(2),
					outputTokens: output,
					tps: +(output / gen).toFixed(1),
					stopReason: msg.stopReason,
				}) + "\n",
			);
		} catch {
			// 日志失败不影响显示
		}

		if (!SHOW_FINAL_LINE) {
			ctx.ui.setStatus(KEY, undefined);
			return;
		}

		let text = `⚡ ${fmt(output / gen)} tok/s`;
		if (ttft !== undefined && ttft >= 0) text += ` · ttft ${ttft.toFixed(1)}s`;
		text += ` · ${gen.toFixed(1)}s`;
		ctx.ui.setStatus(KEY, text);
	});
}
