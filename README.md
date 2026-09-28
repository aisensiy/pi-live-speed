# pi-live-speed

**See how fast your model is generating, while it's still generating.**

Live token speed in [Pi](https://pi.dev/)'s footer. No commands to run, no dashboard to open, no waiting for the response to finish.

```text
⚡ ~42.0 tok/s · ttft 2.3s · gen 4.1s
```

- **Live speed:** refreshes every 250 ms, even when the stream pauses.
- **Live waiting time:** see how long you've been waiting for the first token.
- **Final speed:** replaces the `~` estimate with provider-reported usage when the response ends.
- **Stays out of the way:** uses Pi's status area without replacing the footer.

## Install

Requires Node.js 22.19+ and Pi. Tested with Pi 0.87.1.

```bash
pi install git:github.com/aisensiy/pi-live-speed
```

Restart Pi or run `/reload`, then send a message. If you previously installed `token-speed.ts`, disable or remove it first to avoid duplicate displays.

The repository currently contains the **0.1.0 release candidate**, available through Git; it has not been published to npm. Live display, response logs and cancellation have been checked on the author's machine. Testing on a second machine is next.

## Good to know

`~` means an estimate during streaming. Final speed uses reported output tokens over the client-observed generation time, including stalls. It is not server-side decoding speed.

Performance logging is enabled by default, without conversation text. See [logging and configuration](docs/configuration.md) to disable it, and [measurement details](docs/measurements.md) for the exact timing and log format.

## Development

```bash
npm ci
npm run check
npm pack --dry-run
```

## License

[MIT](LICENSE)
