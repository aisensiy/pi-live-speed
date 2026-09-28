import { describe, expect, it } from "vitest";
import { Meter, finalStatus } from "../src/meter.ts";

function meter() {
  return new Meter({ sessionId: "session", responseId: "response", provider: "provider", model: "model" }, 0, 10000, "turn_start");
}

describe("response measurements", () => {
  it("updates wait and preserves stalls in generation time", () => {
    const m = meter();
    expect(m.live(2000)).toBe("⏳ ttft 2.0s");
    m.delta("abcd", 2000);
    expect(m.live(3000)).toContain("~1.0 tok/s");
    expect(m.live(6000)).toContain("~0.3 tok/s");
    const r = m.finish(6000, 16000, "completed", "stop", { output: 100 });
    expect(r).toMatchObject({ ttftSec: 2, genSec: 4, elapsedSec: 6, tps: 25, tokenSource: "provider-usage" });
    expect(finalStatus(r)).toBe("⚡ 25.0 tok/s · ttft 2.0s · gen 4.0s");
  });

  it("does not depend on chunk boundaries, including split surrogate pairs", () => {
    const text = "你好abcd😀";
    const full = meter();
    const split = meter();
    full.delta(text, 100);
    for (const unit of text.split("")) split.delta(unit, 100);
    expect(split.live(1100)).toEqual(full.live(1100));
  });

  it("ignores empty deltas and preserves failure without content", () => {
    const m = meter();
    m.delta("", 100);
    const r = m.finish(2000, 12000, "error", "error", { output: 0 });
    expect(r).toMatchObject({ status: "error", ttftSec: null, genSec: null, tps: null, unavailableReason: "no-content-delta" });
  });

  it("records cancellation with partial usage and labels it", () => {
    const m = meter();
    m.delta("thinking", 0);
    const r = m.finish(2000, 12000, "aborted", "aborted", { output: 10 });
    expect(r).toMatchObject({ ttftSec: 0, genSec: 2, tps: 5, status: "aborted" });
    expect(finalStatus(r)).toContain("aborted");
  });

  it("keeps very short samples but does not invent a speed", () => {
    const m = meter();
    m.delta("x", 1000);
    expect(m.finish(1020, 11020, "completed", "stop", { output: 100 })).toMatchObject({ tps: null, unavailableReason: "short-generation" });
  });

  it.each([undefined, 0, -1, NaN, Infinity])("does not use unavailable or invalid usage %s", (output) => {
    const m = meter();
    m.delta("secret content", 1000);
    const r = m.finish(3000, 13000, "completed", "stop", { output });
    expect(r.tps).toBeNull();
    expect(r.tokenSource).toBe("unavailable");
    expect(JSON.stringify(r)).not.toContain("secret content");
  });

  it("wall-clock jumps do not change durations", () => {
    const m = meter();
    m.delta("x", 1000);
    expect(m.finish(3000, 1, "completed", "stop", { output: 20 })).toMatchObject({ ttftSec: 1, genSec: 2, tps: 10 });
  });
});
