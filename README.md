# Grok Micro

Brings the [Work Louder Codex Micro](https://worklouder.cc) macropad to [Grok CLI](https://github.com/superagent-ai/grok-cli).

Six live Agent Keys, factory lighting/gestures, and authenticated routing to the
exact Grok session each key represents — without redistributing proprietary
Codex Micro firmware or native modules.

| | |
| --- | --- |
| **Platform** | macOS (native app focus) and Linux HID (USB smoked; BLE needs udev). Node 20+, pnpm; Grok side uses Bun |
| **Hardware** | Codex Micro (`VID 0x303A` / `PID 0x8360`) or Creator Micro V2-compatible |
| **Status** | Public pre-release on [GitHub](https://github.com/derekclair/grok-micro); macOS USB smoke verified (connect + lighting + Agent Key select on firmware v0.6.1); Linux USB HID + control-stub smoked on a real Codex Micro |

## Repository layout

```text
.
├── grok-micro/                 # HID daemon, protocol package, doctor, hooks, Linux udev
├── grok-cli/                   # Grok CLI tree + local control protocol (v1)
├── grok-cli-control.patch      # Same Grok-side changes for a clean upstream checkout
├── PARITY.md                   # Native behavioral contract
├── native-parity-fixtures.json # Executable acceptance data
└── SECURITY.md
```

## Quick start

### Easiest (macOS, verified)

```sh
# Terminal A
./scripts/start-daemon.sh

# Terminal B (needs GROK_API_KEY or XAI_API_KEY in env / .env)
./scripts/start-grok.sh

# Optional
./scripts/status.sh
./scripts/stop-daemon.sh
```

Grant **Input Monitoring** to Terminal (or whatever hosts Node). Quit ChatGPT /
Codex / Work Louder Input while using the daemon so they do not steal the pad.

### 1. Grok CLI with local control

Use the included tree:

```sh
cd grok-cli
bun install
bun run typecheck
bun run build
bun run dist/index.js --no-sandbox
```

Or patch a pinned upstream checkout:

```sh
git clone https://github.com/superagent-ai/grok-cli.git
cd grok-cli
git checkout fb97af83f06dca873281d60168430f06c8de6324
git apply /path/to/grok-micro/grok-cli-control.patch
bun install && bun run typecheck && bun run build
```

Interactive sessions publish `~/.grok/control/<pid>.json` (mode `0600` in a
`0700` directory). Treat those records as secrets. See
[`grok-cli/docs/local-control.md`](grok-cli/docs/local-control.md).

### 2. Hardware daemon

```sh
cd grok-micro
pnpm install
pnpm verify
pnpm start
```

Grant **Input Monitoring** when macOS prompts. On Linux, install hidraw udev
rules so the daemon can open the vendor interface without root:

```sh
sudo ./linux/install-udev.sh   # from grok-micro/
```

Run `pnpm doctor` if the device is not detected. Work Louder documents that
Karabiner / Logitech Options+ can interfere with Micro communication. Do not
run the Work Louder Input AppImage at the same time as this daemon — both open
the same HID interface.

Optional: `pnpm control-stub` publishes a local Grok control v1 socket so Agent
Keys light and gestures can be smoked without an interactive Grok CLI session.
It writes `~/.grok/control/<pid>.json` (mode `0600`); treat that file as secret.

Optional degraded lighting-only hooks (no authenticated action route):

```sh
pnpm install-hooks
pnpm uninstall-hooks
```

## What is replicated

- Native HID framing/RPC (report id 6, 50 ms queue pacing, random ids `0..998`,
  10 s ACK + single retry)
- Factory palette and effects, selection accent, voice/snaking precedence,
  auto-dim, input-quiet debounce
- Six-session recent registry with stable slots and last-displayed routing
- Agent double-tap focus, ACT11 suppression, encoder/joystick/PTT timelines
- Semantic Grok actions: session select/fork, submit, guarded approve/decline,
  plan toggle, reasoning adjust, 160 px conversation scroll

**Explicitly unsupported** (fail closed as `unsupported`, never approximated):

- Codex FAST mode, native voice PTT, composer-highlight navigation, sidebar /
  history navigation, `/settings/codex-micro`

Details: [`PARITY.md`](PARITY.md) and
[`grok-micro/README.md`](grok-micro/README.md).

## Verification

Run on this tree:

| Package | Result |
| --- | --- |
| `grok-micro` `pnpm verify` | build + `tsc` + protocol/bridge tests |
| `grok-cli` control suite | `bun run test:control`; `tsc --noEmit` clean |

Linux USB HID was smoked on a real Codex Micro: vendor RPC (`sys.version`,
`device.status`, lighting), udev-backed hidraw, daemon reconnect, and
control-stub action routing (Agent Key select `ok`; FAST remains
`unsupported`). Bluetooth HOGP enumerates the same vendor collection once the
udev BLE rule is installed; treat BLE pairing slots as a later pass. App focus
is still macOS-only.

Exercise the remaining acceptance cases in `PARITY.md` against interactive
Grok CLI (not only the control stub) before calling a revision production
ready.

## Security model

- Discovery: owner + mode checks, live PID, absolute socket path, token length
- Auth: first NDJSON line must authenticate; constant-time token compare
- Actions: no prompt/transcript storage in the daemon; unsupported ≠ keystroke guess

See [`SECURITY.md`](SECURITY.md).

## Attribution

- Protocol foundation and lineage: [qGolem/claude-micro](https://github.com/qGolem/claude-micro) (MIT)
- Research cross-checks: [thannous/claude-codex-micro](https://github.com/thannous/claude-codex-micro),
  [eliBenven/freemicro](https://github.com/eliBenven/freemicro)
- Grok CLI base: [superagent-ai/grok-cli](https://github.com/superagent-ai/grok-cli)
- Native Codex Micro behavior remains the acceptance authority for parity fixtures

Full notices: [`LICENSE`](LICENSE), [`grok-micro/ATTRIBUTION.md`](grok-micro/ATTRIBUTION.md).

## Distribution note

Published at [github.com/derekclair/grok-micro](https://github.com/derekclair/grok-micro)
under MIT as a **pre-release** until hardware smoke is documented. It does
**not** ship proprietary Work Louder/OpenAI binaries. Prefer the
`grok-cli-control.patch` path if you already track upstream Grok CLI and only
want the control-plane delta.
