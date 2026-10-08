export interface Identity {
  sessionId: string;
  responseId: string;
  provider: string | null;
  model: string | null;
}

export interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export type Outcome = "completed" | "error" | "aborted" | "incomplete";

export interface RecordV1 extends Identity {
  schemaVersion: 1;
  scope: "assistant-response";
  timingSource: "turn_start" | "message_start";
  startedAt: number;
  ts: number;
  elapsedSec: number;
  ttftSec: number | null;
  genSec: number | null;
  outputTokens: number | null;
  inputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  tokenSource: "provider-usage" | "unavailable";
  tps: number | null;
  unavailableReason: string | null;
  status: Outcome;
  stopReason: string | null;
}

const count = (n: number | undefined): number | null =>
  n !== undefined && Number.isFinite(n) && n >= 0 ? n : null;
const fmt = (n: number) => n >= 100 ? Math.round(n).toString() : n.toFixed(1);

/** A response clock; all durations use injected monotonic milliseconds. Never retains content. */
export class Meter {
  private firstContent: number | null = null;
  private cjk = 0;
  private other = 0;

  constructor(
    readonly identity: Identity,
    readonly start: number,
    readonly startedAt: number,
    readonly timingSource: RecordV1["timingSource"],
  ) {}

  /** Mark observed output without adding bytes to the token estimate. */
  observeContent(now: number): void {
    this.firstContent ??= now;
  }

  delta(text: string, now: number): void {
    if (!text) return;
    this.observeContent(now);
    // UTF-16 units keep the estimate invariant even when a surrogate pair is split across chunks.
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if ((code >= 0x3000 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef)) this.cjk++;
      else this.other++;
    }
  }

  live(now: number): string {
    if (this.firstContent === null) return `⏳ ttft ${fmt((now - this.start) / 1000)}s`;
    const gen = (now - this.firstContent) / 1000;
    const speed = gen >= 0.05 ? `~${fmt((this.cjk + this.other / 4) / gen)}` : "--";
    return `⚡ ${speed} tok/s · ttft ${fmt((this.firstContent - this.start) / 1000)}s · gen ${fmt(gen)}s`;
  }

  finish(now: number, wall: number, status: Outcome, stopReason: string | null, usage?: Usage): RecordV1 {
    const gen = this.firstContent === null ? null : (now - this.firstContent) / 1000;
    const output = count(usage?.output);
    let unavailableReason: string | null = null;
    let tps: number | null = null;
    if (gen === null) unavailableReason = "no-content-delta";
    else if (gen < 0.05) unavailableReason = "short-generation";
    else if (output === null || output === 0) unavailableReason = "no-output-usage";
    else tps = output / gen;
    return {
      ...this.identity,
      schemaVersion: 1,
      scope: "assistant-response",
      timingSource: this.timingSource,
      startedAt: this.startedAt,
      ts: wall,
      elapsedSec: (now - this.start) / 1000,
      ttftSec: this.firstContent === null ? null : (this.firstContent - this.start) / 1000,
      genSec: gen,
      outputTokens: output,
      inputTokens: count(usage?.input),
      cacheReadTokens: count(usage?.cacheRead),
      cacheWriteTokens: count(usage?.cacheWrite),
      tokenSource: output !== null && output > 0 ? "provider-usage" : "unavailable",
      tps,
      unavailableReason,
      status,
      stopReason,
    };
  }
}

export function finalStatus(record: RecordV1): string {
  const outcome = record.status === "completed" ? "" : ` · ${record.status}`;
  return `⚡ ${record.tps === null ? "--" : fmt(record.tps)} tok/s`
    + ` · ttft ${record.ttftSec === null ? "--" : fmt(record.ttftSec)}s`
    + ` · gen ${record.genSec === null ? "--" : fmt(record.genSec)}s${outcome}`;
}
