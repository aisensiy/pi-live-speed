import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RecordV1 } from "../src/meter.ts";

const environment = vi.hoisted(() => ({ dir: "" }));
vi.mock("@earendil-works/pi-coding-agent", () => ({ getAgentDir: () => environment.dir }));
import liveSpeed from "../src/index.ts";

type Handler = (event: never, ctx: ExtensionContext) => unknown;
let handlers: Map<string, Handler>;
let ctx: ExtensionContext;
let statuses: Map<string, string>;
let notify: ReturnType<typeof vi.fn>;

function emit(name: string, event: unknown = {}) { return handlers.get(name)?.(event as never, ctx); }
function assistant(stopReason = "stop", output = 100, model = "model") {
  return { role: "assistant", provider: "provider", model, stopReason, usage: { output, input: 20 }, content: [], timestamp: Date.now() };
}
function delta(text = "abcd", type = "text_delta") {
  emit("message_update", { message: assistant(), assistantMessageEvent: { type, delta: text } });
}
function toolStart(name: string, contentIndex = 0) {
  const message = {
    ...assistant("toolUse", 10),
    content: [{ type: "toolCall", id: "call", name, arguments: {} }],
  };
  emit("message_update", {
    message,
    assistantMessageEvent: { type: "toolcall_start", contentIndex, partial: message },
  });
  return message;
}
function rows(): RecordV1[] {
  const path = join(environment.dir, "pi-live-speed.jsonl");
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
}

beforeEach(() => {
  vi.useFakeTimers();
  environment.dir = mkdtempSync(join(tmpdir(), "pi-live-speed-extension-"));
  handlers = new Map();
  statuses = new Map();
  notify = vi.fn();
  ctx = {
    hasUI: true,
    model: { provider: "provider", id: "model" },
    sessionManager: { getSessionId: () => "session" },
    ui: {
      notify,
      setStatus: (key: string, value?: string) => value === undefined ? statuses.delete(key) : statuses.set(key, value),
    },
  } as unknown as ExtensionContext;
  liveSpeed({ on: (name: string, handler: Handler) => { handlers.set(name, handler); } } as unknown as ExtensionAPI);
  emit("session_start");
});
afterEach(() => {
  emit("session_shutdown");
  vi.useRealTimers();
  rmSync(environment.dir, { recursive: true, force: true });
});

it("ticks without deltas, includes pauses, then uses final usage and stops its timer", () => {
  emit("turn_start");
  vi.advanceTimersByTime(2000);
  expect(statuses.get("pi-live-speed")).toBe("⏳ ttft 2.0s");
  emit("message_start", { message: assistant() });
  delta();
  vi.advanceTimersByTime(1000);
  expect(statuses.get("pi-live-speed")).toContain("~1.0 tok/s");
  vi.advanceTimersByTime(3000);
  expect(statuses.get("pi-live-speed")).toContain("gen 4.0s");
  emit("message_end", { message: assistant() });
  expect(rows()).toHaveLength(1);
  expect(rows()[0]).toMatchObject({ tps: 25, ttftSec: 2, genSec: 4, status: "completed", firstContentSource: "content-delta" });
  expect(vi.getTimerCount()).toBe(0);
  emit("agent_end");
  expect(rows()).toHaveLength(1);
});

it("does not include tool execution in the next response", () => {
  emit("turn_start");
  delta("thinking", "thinking_delta");
  vi.advanceTimersByTime(1000);
  emit("message_end", { message: assistant("toolUse", 10) });
  vi.advanceTimersByTime(30000);
  emit("message_start", { message: { role: "toolResult" } });
  emit("message_end", { message: { role: "toolResult" } });
  emit("turn_start");
  vi.advanceTimersByTime(1000);
  emit("message_start", { message: assistant("stop", 40, "other-model") });
  delta("{\"key\":1}", "toolcall_delta");
  vi.advanceTimersByTime(2000);
  emit("message_end", { message: assistant("stop", 40, "other-model") });
  expect(rows()).toHaveLength(2);
  expect(rows()[1]).toMatchObject({ model: "other-model", ttftSec: 1, genSec: 2, tps: 20 });
  expect(rows()[0].responseId).not.toBe(rows()[1].responseId);
});

it.each([0, 30_000, 120_000])("keeps TTFT independent of a %ims tool execution and tool argument generation", (toolDuration) => {
  emit("turn_start");
  emit("message_start", { message: assistant("toolUse", 10) });
  vi.advanceTimersByTime(1000);
  // A tool-only response has no text or thinking deltas before its arguments.
  delta('{"command":', "toolcall_delta");
  vi.advanceTimersByTime(5000);
  delta('"pwd"}', "toolcall_delta");
  emit("message_end", { message: assistant("toolUse", 10) });
  const finishedStatus = statuses.get("pi-live-speed");
  expect(rows()[0]).toMatchObject({ ttftSec: 1, genSec: 5, elapsedSec: 6 });
  expect(vi.getTimerCount()).toBe(0);

  emit("tool_execution_start", { toolCallId: "call", toolName: "bash", args: {} });
  vi.advanceTimersByTime(toolDuration);
  emit("tool_execution_end", { toolCallId: "call", toolName: "bash", isError: false });
  emit("message_start", { message: { role: "toolResult" } });
  emit("message_end", { message: { role: "toolResult" } });
  emit("turn_end");
  expect(statuses.get("pi-live-speed")).toBe(finishedStatus);
  expect(rows()).toHaveLength(1);

  emit("turn_start");
  expect(statuses.get("pi-live-speed")).toBe("⏳ ttft 0.0s");
  emit("message_start", { message: assistant() });
  vi.advanceTimersByTime(2000);
  delta("answer");
  vi.advanceTimersByTime(1000);
  emit("message_end", { message: assistant() });
  expect(rows()[1]).toMatchObject({ ttftSec: 2, genSec: 1, elapsedSec: 3 });
});

it("recognizes a named tool call as first output before its arguments arrive", () => {
  emit("turn_start");
  emit("message_start", { message: assistant("toolUse", 10) });
  vi.advanceTimersByTime(1000);
  const message = toolStart("bash");
  vi.advanceTimersByTime(5000);
  delta('{"command":"pwd"}', "toolcall_delta");
  vi.advanceTimersByTime(1000);
  emit("message_end", { message });
  expect(rows()[0]).toMatchObject({ ttftSec: 1, genSec: 6, firstContentSource: "named-tool-call" });
});

it.each([true, false])("times a named tool call without argument deltas (UI=%s) without estimating name tokens", (hasUI) => {
  ctx.hasUI = hasUI;
  emit("turn_start");
  vi.advanceTimersByTime(1000);
  const message = toolStart("bash");
  if (!hasUI) expect(statuses.get("pi-live-speed")).toContain("ttft 1.0s · gen 0.0s");
  vi.advanceTimersByTime(2000);
  // Use an empty delta to request a headless refresh without adding content.
  delta("", "toolcall_delta");
  expect(statuses.get("pi-live-speed")).toContain("~0.0 tok/s · ttft 1.0s · gen 2.0s");
  emit("message_end", { message });
  expect(rows()[0]).toMatchObject({ ttftSec: 1, genSec: 2, tps: 5, unavailableReason: null });
});

it.each([["", 0], ["bash", 1]] as const)("ignores tool starts without an observed name (%s, index %i)", (name, index) => {
  emit("turn_start");
  vi.advanceTimersByTime(1000);
  toolStart(name, index);
  vi.advanceTimersByTime(2000);
  expect(statuses.get("pi-live-speed")).toBe("⏳ ttft 3.0s");
  delta("{}", "toolcall_delta");
  vi.advanceTimersByTime(1000);
  emit("message_end", { message: assistant("toolUse", 10) });
  expect(rows()[0]).toMatchObject({ ttftSec: 3, genSec: 1, firstContentSource: "content-delta" });
});

it("does not reset first output when a named tool call follows thinking", () => {
  emit("turn_start");
  vi.advanceTimersByTime(1000);
  delta("thinking", "thinking_delta");
  vi.advanceTimersByTime(2000);
  const message = toolStart("bash");
  vi.advanceTimersByTime(1000);
  emit("message_end", { message });
  expect(rows()[0]).toMatchObject({ ttftSec: 1, genSec: 3, firstContentSource: "content-delta" });
});

it.each(["error", "aborted"])("logs %s before any output exactly once", (reason) => {
  emit("turn_start");
  vi.advanceTimersByTime(1000);
  emit("message_start", { message: assistant(reason, 0) });
  emit("message_end", { message: assistant(reason, 0) });
  emit("agent_end");
  emit("session_shutdown");
  expect(rows()).toHaveLength(1);
  expect(rows()[0]).toMatchObject({ status: reason, tps: null, ttftSec: null, firstContentSource: null });
});

it("separates exposed automatic retry turns", () => {
  for (const reason of ["error", "stop"]) {
    emit("turn_start");
    emit("message_start", { message: assistant(reason) });
    delta();
    vi.advanceTimersByTime(1000);
    emit("message_end", { message: assistant(reason) });
    emit("agent_end");
  }
  expect(rows().map(row => row.status)).toEqual(["error", "completed"]);
});

it("logs an interrupted response at shutdown and clears statuses and timers", () => {
  emit("turn_start");
  vi.advanceTimersByTime(1000);
  emit("session_shutdown");
  emit("session_shutdown");
  expect(rows()).toHaveLength(1);
  expect(rows()[0]).toMatchObject({ status: "incomplete", stopReason: "session-shutdown" });
  expect(statuses.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("supports logging disabled while maintaining display", () => {
  writeFileSync(join(environment.dir, "pi-live-speed.json"), '{"logging":false}');
  emit("session_start");
  emit("turn_start");
  delta();
  vi.advanceTimersByTime(1000);
  emit("message_end", { message: assistant() });
  expect(rows()).toEqual([]);
  expect(statuses.get("pi-live-speed")).toContain("100 tok/s");
});

it("invalid config fails closed and warns", () => {
  writeFileSync(join(environment.dir, "pi-live-speed.json"), '{"logging":"false"}');
  emit("session_start");
  emit("turn_start");
  emit("message_end", { message: assistant("error", 0) });
  expect(rows()).toEqual([]);
  expect(notify).toHaveBeenCalledTimes(1);
});

it("warns once on write failure without breaking display", () => {
  const blocker = join(environment.dir, "not-a-directory");
  writeFileSync(blocker, "");
  writeFileSync(join(environment.dir, "pi-live-speed.json"), JSON.stringify({ logPath: join(blocker, "log.jsonl") }));
  emit("session_start");
  for (let i = 0; i < 2; i++) {
    emit("turn_start");
    delta();
    vi.advanceTimersByTime(1000);
    emit("message_end", { message: assistant() });
  }
  expect(notify).toHaveBeenCalledTimes(1);
  expect(statuses.get("pi-live-speed-log")).toContain("unavailable");
  expect(statuses.get("pi-live-speed")).toContain("100 tok/s");
});

it("records fallback timing when the host omits turn_start", () => {
  emit("message_start", { message: assistant() });
  vi.advanceTimersByTime(1000);
  delta();
  vi.advanceTimersByTime(1000);
  emit("message_end", { message: assistant() });
  expect(rows()[0]).toMatchObject({ timingSource: "message_start", ttftSec: 1, genSec: 1 });
});

it("marks an unfinished turn incomplete when another turn supersedes it", () => {
  emit("turn_start");
  vi.advanceTimersByTime(1000);
  emit("turn_start");
  expect(rows()[0]).toMatchObject({ status: "incomplete", stopReason: "superseded" });
  expect(vi.getTimerCount()).toBe(1);
});

it("reload cleans up an active measurement before loading a new configuration", () => {
  emit("turn_start");
  delta();
  vi.advanceTimersByTime(1000);
  emit("session_shutdown");
  emit("session_start");
  expect(rows()).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(statuses.size).toBe(0);
});

it("agent_end without a terminal message preserves an incomplete sample", () => {
  emit("turn_start");
  vi.advanceTimersByTime(1000);
  emit("agent_end");
  emit("agent_end");
  expect(rows()).toHaveLength(1);
  expect(rows()[0]).toMatchObject({ status: "incomplete", stopReason: "agent-end-without-message" });
  expect(vi.getTimerCount()).toBe(0);
});

it("headless sessions log without starting timers", () => {
  ctx.hasUI = false;
  emit("turn_start");
  expect(vi.getTimerCount()).toBe(0);
  delta();
  vi.advanceTimersByTime(1000);
  emit("message_end", { message: assistant() });
  expect(rows()).toHaveLength(1);
});
