# Measurement contract (schema v1)

## Scope and event boundaries

One row measures one **assistant response observed through Pi's main extension event stream**, not a whole user prompt, tool batch, or HTTP request attempt.

Pi 0.87.1 emits `turn_start` before preparing and streaming each response. `message_start` may arrive only after the provider starts streaming, and is also emitted for immediate errors. `message_end` closes the response before tool execution begins. A tool-following response starts a new turn.

Source: [Pi v0.87.1 agent-loop.ts](https://github.com/earendil-works/pi/blob/v0.87.1/packages/agent/src/agent-loop.ts), particularly `runLoop` and `streamAssistantResponse`.

We deliberately do not use provider request hooks as a primary clock: their public events do not carry a response/request correlation ID, and nested model calls or internal retries cannot safely be attributed to one assistant response. This first version favors an explicit client-observed wait over a misleading network-only TTFT.

- Start: monotonic clock at `turn_start`; fallback to `message_start` if a host omits the turn event. `timingSource` records the distinction.
- First content: first non-empty `text_delta`, `thinking_delta` or `toolcall_delta`. Start events and empty deltas do not count.
- TTFT: first content minus start. Includes client preparation and transport, potentially provider-internal retries.
- Generation seconds: `message_end` minus first content. Includes stream stalls and final usage/stream-finalization delays. Never subtracts stalls.
- Final TPS: positive, finite provider `usage.output` divided by generation seconds. Output includes reasoning if the provider accounts for it there.
- Live TPS: accumulated CJK units plus other UTF-16 units divided by four, divided by generation seconds. Fractional counts are accumulated, not rounded per chunk. This is a heuristic, not tokenization; always marked `~`.
- Fewer than 50 ms of generation, missing positive output usage, or no content delta: TPS is `null`, never a fabricated zero. Zero usage may mean an unreported value, not necessarily zero work.

Durations use `performance.now()` and survive wall-clock changes. Epoch timestamps use `Date.now()` for historical grouping. Client buffering, hidden reasoning and bursty delivery can distort measured speed; it is not the server's internal decoding throughput.

## Lifecycle and coverage

`error` and `aborted` terminal messages are logged even without content or positive usage. A response with no terminal message is recorded as `incomplete` at `agent_end`, session shutdown, session replacement or supersession. Timers are stopped on each completion and shutdown; no timer starts during module discovery or in headless sessions.

Automatic retries that Pi exposes as separate turns get separate rows and response IDs. **Internal HTTP retries within a provider are not separate rows.** Calls by other extensions that do not emit main assistant events are outside this log. Abrupt process termination (for example SIGKILL) cannot flush an active response. This is not a complete HTTP request ledger, and its failure rate must be labeled as an observed assistant-response failure rate.

We do not record raw error messages: they can contain credentials, URLs or conversation fragments. `status` and the controlled `stopReason` category are the first version's failure information; HTTP error classification and attempt correlation are deferred.

## JSONL fields

Each line is a standalone object. No prior line or process-global state is needed.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1` |
| `scope` | `assistant-response` |
| `sessionId`, `responseId` | Pi session identifier and a fresh response UUID |
| `provider`, `model` | Terminal assistant identity, or initial context identity when no terminal message exists; nullable |
| `timingSource` | `turn_start` or fallback `message_start` |
| `startedAt`, `ts` | Start/end epoch milliseconds |
| `elapsedSec`, `ttftSec`, `genSec` | Monotonic durations in seconds; unavailable TTFT/generation is null |
| `outputTokens`, `inputTokens`, `cacheReadTokens`, `cacheWriteTokens` | Non-negative provider usage, or null if missing/invalid |
| `tokenSource` | `provider-usage` when output is positive, otherwise `unavailable` |
| `tps` | Final average, or null |
| `unavailableReason` | Null when measurable; otherwise `no-content-delta`, `short-generation`, or `no-output-usage` |
| `status` | `completed`, `error`, `aborted`, `incomplete` |
| `stopReason` | Pi terminal reason or a lifecycle category such as `session-shutdown` |

Raw prompts, deltas, reasoning, tool arguments, endpoint URLs and error text are never added to these records. Existing legacy history is not rewritten or mixed with schema v1 by default.

## Comparing suppliers

Separate successes, errors, user cancellations and incomplete samples. Report counts and missing-value coverage. For valid comparable samples, aggregate throughput as `sum(outputTokens) / sum(genSec)`, not the average of response TPS values. TTFT and speed percentiles are useful alongside throughput.

Compare equivalent provider/model, timing source, input/cache and output length ranges. Thinking settings and task difficulty can still confound results; v1 does not record every such dimension and is not a controlled benchmark. Answer quality needs separate tests, task outcomes or human ratings.

## Pending acceptance

Before migrating the personal installation: verify real terminal visibility during waiting, output and stalls; narrow-width behavior; cancel/reload behavior; and live provider usage reporting. Automated event replay and loader tests do not substitute for those checks.
