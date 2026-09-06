# Grok Micro

An external macOS daemon that replicates the native Work Louder Codex Micro
experience for [Grok CLI](https://github.com/superagent-ai/grok-cli): six live
Agent keys, factory lighting, native gestures, and authenticated routing to the
exact Grok session represented by each key.

This is a derivative of qGolem's MIT-licensed `claude-micro`. The pure
`codex-micro-protocol` package and its attribution are intentionally preserved;
see [ATTRIBUTION.md](ATTRIBUTION.md).

## Requirements

- Node.js 20+, pnpm, and a Work Louder vendor interface at VID `303a`,
  usage page `ff00`: Codex Micro PID `8360`, or Creator Micro V2-compatible
  PID `33431`/`33432`
- macOS: Input Monitoring permission for the process running the daemon
- Linux: hidraw udev rules (`linux/install-udev.sh`) so USB and BLE nodes are
  not `root:root` `0600`. App focus is unsupported (fail closed).
- Grok CLI with local control protocol v1 for reliable events/actions, or
  `pnpm control-stub` for HID/lighting/action-mapping smoke only

The daemon reproduces the native candidate order: USB Codex Micro, USB Creator
Micro V2, Bluetooth Codex Micro, then Bluetooth Creator Micro V2. Unknown
transport descriptors rank last. HID opens non-exclusively and uses the native
request pacing.

## Install and run

```sh
pnpm install
pnpm verify
pnpm start
```

Grok CLI publishes authenticated discovery records under `~/.grok/control`.
The daemon validates the directory (`0700`), record (`0600`), socket (`0600`),
owner, live PID, protocol version, and token before connecting. It authenticates
first, consumes bounded event replay/live events, and sends exact actions over
the session's Unix socket. Tokens never enter the persisted slot file or logs.

If the Grok build has no native event stream, install the degraded hook fallback:

```sh
pnpm install-hooks
pnpm uninstall-hooks
```

The installer merges its command into `~/.grok/user-settings.json` without
changing existing matchers/hooks. Fallback hooks provide lighting, but not an
authenticated action route.

## Native behavior reproduced

- Factory colors: working `#304FFE`, unread `#00FF4C`, idle `#FFFFFF`, human
  input `#FF6D00`, error `#FF0033`, empty/off `#000000`.
- Agent keys are solid unless selected or explicitly pulsing; those use breath
  effect `4`, speed `.4`.
- Selected working session uses snake ambient; selection accent lasts four
  seconds. Input quiet time is 100 ms. All zones auto-off after three minutes
  and wake on activity/state change.
- First Agent-key press selects its exact session; a second press on the same
  slot **and session** within 350 ms requests primary app focus.
- FAST, approve, decline, fork, wide MIC, submit, encoder and joystick use pure
  native state machines. ACT11 is ignored because the wide MIC cap already
  triggers ACT10.
- Encoder hold fires at 500 ms while still held. Joystick directions activate
  only on change above distance `.5` and re-arm below `.5`.
- MIC implements native 350 ms press/double-tap latch behavior.

## Exact action support

No key is converted to a guessed terminal keystroke. Unsupported native actions
are written to daemon health as `lastAction.code: "unsupported"` and printed to
stderr.

| Codex Micro action | Grok control v1 |
| --- | --- |
| Select represented thread | `thread.select` |
| Toggle plan mode | `composer.togglePlanMode` |
| Approve / decline | `approval.respond` |
| Fork thread | `thread.fork` |
| Submit | `composer.submit` |
| Primary app focus | Deterministic Terminal/iTerm tab focus from authenticated route metadata |
| Reasoning encoder turns | `reasoning.adjust` |
| Conversation scroll turns/click | `conversation.scroll` (`up` / `down` / `bottom`) |
| FAST toggle | Explicitly unsupported (Grok `mode.cycle` is not equivalent) |
| Voice PTT/latch | Explicitly unsupported |
| Composer menus/navigation/activation | Explicitly unsupported |
| Reasoning options click | Explicitly unsupported |
| Sidebar, back/forward navigation, settings | Explicitly unsupported |

## Runtime model

```text
Grok control sockets -> authenticated events -> six-session recent registry
                                                |               |
Codex Micro HID <- RGB/RPC <- lighting policy <-+               +-> exact action route
                -> native gesture interpreter ------------------^
```

The registry keeps physical slots stable while occupied and evicts the
least-recent session when a seventh arrives. The same registry drives lighting
and action routing. Control credentials exist only in memory.

Device calls are serialized, spaced 50 ms, use random IDs `0..998`, wait for a
correlated ACK for ten seconds, and retry once immediately on timeout. Lighting
writes are deduplicated and ordered exactly as native: `rgbcfg`, then
`thstatus`. Reconnect delays are 1, 2, 5, then 10 seconds. The daemon starts
without hardware and detects topology changes every 30 seconds.

The selected-unread acknowledgement override requires Grok to emit
`appFocused: true`; builds without a focus event conservatively keep unread
lighting.

## Diagnostics and configuration

```sh
pnpm doctor
```

Useful environment variables:

| Variable | Default |
| --- | --- |
| `GROK_MICRO_SOCKET` | macOS `/private/tmp/grok-micro.sock`; otherwise `$TMPDIR/grok-micro.sock` |
| `GROK_MICRO_SLOTS` | same directory, `grok-micro-slots.json` |
| `GROK_MICRO_HEALTH` | same directory, `grok-micro-health.json` |
| `GROK_MICRO_DEVICE_LOCK` | same directory, `grok-micro-device.lock` |
| `GROK_MICRO_RUNTIME_DIR` | override the directory for all of the above |
| `GROK_MICRO_CONTROL_DIR` | `~/.grok/control` |
| `GROK_MICRO_BRIGHTNESS` | `1` |
| `GROK_MICRO_AUTO_OFF_MS` | `180000` |
| `GROK_MICRO_SINGLE_TAP_FOCUS` | `0` |
| `GROK_MICRO_ENCODER_MODE` | `composer-navigation` |

## Development

```sh
pnpm verify
```

Protocol tests cover byte framing/RPC/input/lighting. Bridge tests cover the
factory palette, gestures, recent registry, fail-closed action mapping,
authenticated NDJSON routing/discovery permissions, and lossless hook install.

Never expose `sys.bootloader` or firmware filesystem writes in this package.
