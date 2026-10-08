import { randomUUID } from "node:crypto";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { finalStatus, Meter, type Outcome, type Usage } from "./meter.ts";
import { appendRecord, loadConfig, type Config } from "./storage.ts";

const KEY = "pi-live-speed";
const WARNING_KEY = "pi-live-speed-log";

export default function liveSpeed(pi: ExtensionAPI): void {
  let active: Meter | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let config: Config = { logging: false, logPath: "" };
  let warned = false;

  function warn(ctx: ExtensionContext, message: string): void {
    if (warned) return;
    warned = true;
    // Do not expose filesystem errors: they may contain private paths or values.
    ctx.ui.setStatus(WARNING_KEY, "⚠ live-speed log unavailable");
    ctx.ui.notify(message, "warning");
  }

  function stopTimer(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  function finish(ctx: ExtensionContext, status: Outcome, stopReason: string | null, usage?: Usage): void {
    if (!active) return;
    const record = active.finish(performance.now(), Date.now(), status, stopReason, usage);
    active = undefined;
    stopTimer();
    ctx.ui.setStatus(KEY, finalStatus(record));
    if (config.logging) {
      try {
        appendRecord(config.logPath, record);
      } catch {
        warn(ctx, "pi-live-speed could not append its performance log. Check the configured path and permissions.");
      }
    }
  }

  function start(ctx: ExtensionContext, source: "turn_start" | "message_start"): void {
    if (active) finish(ctx, "incomplete", "superseded");
    active = new Meter({
      sessionId: ctx.sessionManager.getSessionId(),
      responseId: randomUUID(),
      provider: ctx.model?.provider ?? null,
      model: ctx.model?.id ?? null,
    }, performance.now(), Date.now(), source);
    ctx.ui.setStatus(KEY, active.live(performance.now()));
    if (ctx.hasUI) {
      timer = setInterval(() => {
        if (active) ctx.ui.setStatus(KEY, active.live(performance.now()));
      }, 250);
      timer.unref();
    }
  }

  pi.on("session_start", (_event, ctx) => {
    finish(ctx, "incomplete", "session-switch");
    stopTimer();
    warned = false;
    ctx.ui.setStatus(KEY, undefined);
    ctx.ui.setStatus(WARNING_KEY, undefined);
    try {
      config = loadConfig(getAgentDir());
    } catch {
      config = { logging: false, logPath: "" };
      warn(ctx, "pi-live-speed config could not be read. Logging is disabled until a successful reload; check pi-live-speed.json.");
    }
  });

  // A Pi turn is one assistant response plus any subsequent tools, not a whole user prompt.
  // Starting here measures client-observed wait, including context preparation, not network-only TTFT.
  pi.on("turn_start", (_event, ctx) => start(ctx, "turn_start"));
  pi.on("message_start", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    if (!active) start(ctx, "message_start");
    if (active) {
      active.identity.provider = event.message.provider;
      active.identity.model = event.message.model;
    }
  });
  pi.on("message_update", (event, ctx) => {
    if (!active || event.message.role !== "assistant") return;
    const delta = event.assistantMessageEvent;
    if (delta.type === "toolcall_start") {
      const block = delta.partial.content[delta.contentIndex];
      if (block?.type !== "toolCall" || !block.name) return;
      // A tool name is already output; do not wait for its argument deltas.
      active.observeContent(performance.now());
    } else if (delta.type === "text_delta" || delta.type === "thinking_delta" || delta.type === "toolcall_delta") {
      active.delta(delta.delta, performance.now());
    } else {
      return;
    }
    // Ticker handles steady rendering; headless clients still receive an updated status.
    if (!timer) ctx.ui.setStatus(KEY, active.live(performance.now()));
  });
  pi.on("message_end", (event, ctx) => {
    const message = event.message;
    if (message.role !== "assistant") return;
    if (active) {
      active.identity.provider = message.provider;
      active.identity.model = message.model;
    }
    const outcome = message.stopReason === "error" || message.stopReason === "aborted" ? message.stopReason : "completed";
    finish(ctx, outcome, message.stopReason, message.usage);
  });
  pi.on("agent_end", (_event, ctx) => finish(ctx, "incomplete", "agent-end-without-message"));
  pi.on("session_shutdown", (_event, ctx) => {
    finish(ctx, "incomplete", "session-shutdown");
    stopTimer();
    ctx.ui.setStatus(KEY, undefined);
    ctx.ui.setStatus(WARNING_KEY, undefined);
  });
}
