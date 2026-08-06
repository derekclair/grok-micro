# Grok Micro

Clean-room [Work Louder Codex Micro](https://worklouder.cc) control-surface
integration for [Grok CLI](https://github.com/superagent-ai/grok-cli).

Six live Agent Keys, factory lighting/gestures, and authenticated routing to the
exact Grok session each key represents — without redistributing proprietary
Codex Micro firmware or native modules.

| | |
| --- | --- |
| **Platform** | macOS (Node 20+, pnpm; Grok side uses Bun) |
| **Hardware** | Codex Micro (`VID 0x303A` / `PID 0x8360`) or Creator Micro V2-compatible |
| **Status** | Unit-verified; physical USB/BLE smoke tests still recommended |

## Repository layout

```text
.
├── grok-micro/                 # HID daemon, protocol package, doctor, hooks
├── grok-cli/                   # Grok CLI tree + local control protocol (v1)
├── grok-cli-control.patch      # Same Grok-side changes for a clean upstream checkout
├── PARITY.md                   # Native behavioral contract
├── native-parity-fixtures.json # Executable acceptance data
└── SECURITY.md
```

## Quick start

### 1. Grok CLI with local control

Use the included tree:

```sh
cd grok-cli
bun install
bun run typecheck
bun run build
node dist/index.js
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

Grant **Input Monitoring** when macOS prompts. Run `pnpm doctor` if the device
is not detected. Work Louder documents that Karabiner / Logitech Options+ can
interfere with Micro communication.

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

Run on this tree (2026-08-05):

| Package | Result |
| --- | --- |
| `grok-micro` `pnpm verify` | build + `tsc` + **83** tests pass |
| `grok-cli` control suite | **8** focused tests pass; `tsc --noEmit` clean |

Physical device smoke tests are still required before calling a given machine
“production ready.” Exercise the acceptance cases in `PARITY.md`.

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

## Publishing note

This monorepo is intended for public distribution under MIT. It does **not**
ship proprietary Work Louder/OpenAI binaries. Prefer the `grok-cli-control.patch`
path if you already track upstream Grok CLI and only want the control-plane delta.
