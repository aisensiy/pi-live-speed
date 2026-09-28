# pi-live-speed

Live token speed in Pi's footer, with persistent provider performance records.

## Status

Pre-release. The initial commit preserves the existing personal extension and statistics script unchanged. No historical logs or personal settings are included. Do not load this alongside the original `token-speed.ts`: both would measure the same responses.

The current baseline displays estimated output speed while streaming, then provider-reported output tokens per generation second, time to first content, and generation duration. It appends performance metadata to `~/.pi/agent/token-speed.jsonl`.

This is client-observed performance, not server-side decoding speed or an evaluation of answer correctness.

## Development roadmap

Before the first release:

- Refresh waiting and streaming metrics independently of incoming chunks.
- Make token estimates independent of chunk boundaries; distinguish estimates from final usage.
- Define and test request, first-content, and completion timing, including stalls.
- Record errors, cancellations, and responses without measurable speed.
- Add configurable logging without storing conversation text.
- Validate in a real Pi terminal before replacing the existing extension.

Later: richer provider summaries, retention policies, and optional evaluation links.

## Baseline statistics

`scripts/token-speed-stats.sh [log-path]` summarizes the original log format. Requires Bash, jq, column, awk, and GNU date. Its unweighted mean is a legacy diagnostic, not a rigorous provider benchmark.
