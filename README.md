# pi-live-speed

Live token speed in Pi's footer, with persistent provider performance records.

```text
⏳ ttft 2.3s
⚡ ~42.0 tok/s · ttft 2.3s · gen 4.1s
⚡ 45.0 tok/s · ttft 2.3s · gen 5.0s
```

- Refreshes every 250 ms, including while waiting or stalled.
- Marks streaming estimates with `~`; final speed uses provider-reported output usage.
- Keeps errors, cancellations, and unmeasurable responses in JSONL history.
- Logs performance metadata, never prompts, answers, reasoning text, or raw errors.
- Uses Pi's extension status area without replacing other footer components.

## Status and installation

Pre-release, tested against Pi 0.87.1. Automated event replay and the real Pi resource loader are verified; real terminal visual acceptance is still pending. Not published to npm.

For development, clone and install locally:

```bash
git clone https://github.com/aisensiy/pi-live-speed.git
pi install ./pi-live-speed
```

Restart Pi or use `/reload`. **Disable/remove any old `token-speed.ts` before loading this package**, otherwise both extensions run. Do not change a working setup until you are ready to test the new one. Custom footers must render extension statuses; a narrow terminal can truncate them.

## Configuration

Optional `~/.pi/agent/pi-live-speed.json` (or under `PI_CODING_AGENT_DIR`):

```json
{
  "logging": true,
  "logPath": "/absolute/path/to/pi-live-speed.jsonl"
}
```

Default: logging enabled, writing `pi-live-speed.jsonl` inside Pi's agent directory. Set `logging` to `false` to retain live display without writing history. `logPath` must be absolute; omit it for the default. Reload after edits. Invalid configuration disables logging and displays a warning rather than silently using defaults. Write failures also show a warning; they do not interrupt the agent.

Logs contain provider/model names, session identifiers and timestamps, which can still be sensitive. Newly created log files use mode `0600`; existing permissions are unchanged. Logs grow until you archive or delete them: automatic retention is not implemented.

## Measurement and history

`ttft` is **client-observed time to first non-empty content**, measured from Pi's `turn_start`; it includes context preparation, authentication and transport. It is not server-side latency. Generation time runs from first content until `message_end`, includes stalls, and excludes subsequent tool execution. Each assistant response gets its own record.

See [measurement contract and log schema](docs/measurements.md) for limitations, retry coverage and interpretation. Speed and availability do not measure answer correctness.

The original `scripts/token-speed-stats.sh [log-path]` is retained for **legacy `token-speed.jsonl` only**. It requires Bash, jq, column, awk and GNU date. Do not use its unweighted averages or null handling to analyze the new schema.

## Development

```bash
npm ci
npm run check
npm pack --dry-run
```

Tests cover timing, chunk boundaries, stalls, usage correction, errors, cancellation, retries exposed as turns, lifecycle cleanup, configuration, logging and an isolated real Pi loader. They make no provider calls and do not read personal credentials.
