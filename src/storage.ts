import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { RecordV1 } from "./meter.ts";

export interface Config {
  logging: boolean;
  logPath: string;
}

/** Invalid configuration disables logging rather than silently writing to an unintended location. */
export function loadConfig(agentDir: string): Config {
  const defaults: Config = { logging: true, logPath: join(agentDir, "pi-live-speed.jsonl") };
  let text: string;
  try {
    text = readFileSync(join(agentDir, "pi-live-speed.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaults;
    throw error;
  }
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid config");
  const config = value as Record<string, unknown>;
  if (Object.keys(config).some((key) => key !== "logging" && key !== "logPath")) throw new Error("Unknown setting");
  if (config.logging !== undefined && typeof config.logging !== "boolean") throw new Error("Invalid logging setting");
  if (config.logPath !== undefined && (typeof config.logPath !== "string" || !isAbsolute(config.logPath))) {
    throw new Error("logPath must be absolute");
  }
  return {
    logging: config.logging === undefined ? defaults.logging : config.logging as boolean,
    logPath: config.logPath === undefined ? defaults.logPath : config.logPath as string,
  };
}

export function appendRecord(path: string, record: RecordV1): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, JSON.stringify(record) + "\n", { encoding: "utf8", mode: 0o600 });
}
