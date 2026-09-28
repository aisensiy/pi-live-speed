# Logging and configuration

The footer works without configuration. This page covers optional performance history settings; changing them does not change the live display.

## Settings

Optional `~/.pi/agent/pi-live-speed.json` (or under `PI_CODING_AGENT_DIR`):

```json
{
  "logging": true,
  "logPath": "/absolute/path/to/pi-live-speed.jsonl"
}
```

Default: logging enabled, writing `pi-live-speed.jsonl` inside Pi's agent directory. Set `logging` to `false` to retain live display without writing history. `logPath` must be absolute; omit it for the default. Reload after edits.

Invalid configuration disables logging and displays a warning rather than silently using defaults. Write failures also show a warning; they do not interrupt the agent.

## Privacy and retention

Logs contain provider/model names, session identifiers and timestamps, which can still be sensitive. Prompts, answers, reasoning text, tool arguments and raw error messages are not saved by this plugin.

Newly created log files use mode `0600`; existing permissions are unchanged. Logs grow until you archive or delete them: automatic retention is not implemented.

See [measurement contract and schema](measurements.md) before comparing providers. Speed and availability do not measure answer correctness.

## Legacy history

The original `scripts/token-speed-stats.sh [log-path]` is retained for **legacy `token-speed.jsonl` only**. It requires Bash, jq, column, awk and GNU date. Do not use its unweighted averages or null handling to analyze the new schema.

Existing legacy logs are not modified by this plugin.

## Display compatibility

Custom footers must render extension statuses; a narrow terminal can truncate them. If you previously loaded a personal `token-speed.ts` extension, disable or remove that copy before loading this package.
