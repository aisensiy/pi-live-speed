import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { loadConfig, appendRecord } from "../src/storage.ts";
import { Meter } from "../src/meter.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pi-live-speed-test-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

it("defaults to a dedicated log, not the legacy history", () => {
  expect(loadConfig(dir)).toEqual({ logging: true, logPath: join(dir, "pi-live-speed.jsonl") });
});
it("supports disabling logs and a custom absolute path", () => {
  writeFileSync(join(dir, "pi-live-speed.json"), JSON.stringify({ logging: false, logPath: join(dir, "custom.jsonl") }));
  expect(loadConfig(dir)).toEqual({ logging: false, logPath: join(dir, "custom.jsonl") });
});
it.each(['null', '[]', '{', '{"logging":"false"}', '{"logPath":"relative"}', '{"loging":false}'])("rejects invalid configuration %s", (text) => {
  writeFileSync(join(dir, "pi-live-speed.json"), text);
  expect(() => loadConfig(dir)).toThrow();
});
it("appends independent JSONL rows with restrictive new-file permissions", () => {
  const record = new Meter({ sessionId: "s", responseId: "r", provider: "p", model: "m" }, 0, 1000, "turn_start")
    .finish(1000, 2000, "error", "error");
  const path = join(dir, "logs", "history.jsonl");
  appendRecord(path, record);
  appendRecord(path, record);
  expect(readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line))).toEqual([record, record]);
  if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
});
