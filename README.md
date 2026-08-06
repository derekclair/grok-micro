# Grok Micro replication

This deliverable is a clean-room Work Louder Codex Micro integration for
[`superagent-ai/grok-cli`](https://github.com/superagent-ai/grok-cli), based on
the observable behavior of Codex desktop `26.727.51351` (build `6119`). It does
not redistribute the proprietary native implementation.

## Contents

- `grok-cli/` — a complete source tree based on Grok CLI commit
  `fb97af83f06dca873281d60168430f06c8de6324`, extended with an authenticated
  local control protocol and semantic UI actions.
- `grok-cli-control.patch` — the same Grok-side changes as an applyable patch.
- `grok-micro/` — the macOS HID daemon, protocol package, installer, tests, and
  diagnostics.
- `PARITY.md` and `native-parity-fixtures.json` — the clean-room behavioral
  contract and executable acceptance data.

## Install

To use the included Grok source tree:

```sh
cd grok-cli
bun install
bun run typecheck
bun run build
node dist/index.js
```

In another terminal, install and start the hardware daemon:

```sh
cd grok-micro
pnpm install
pnpm verify
pnpm start
```

The Grok process publishes a private discovery record in `~/.grok/control`.
The daemon validates ownership and permissions, authenticates with a random
per-process token, subscribes to lifecycle events, and sends acknowledged
semantic actions. No prompt, tool argument, model output, transcript, or token
is stored by the daemon.

To patch a clean checkout instead:

```sh
git clone https://github.com/superagent-ai/grok-cli.git
cd grok-cli
git checkout fb97af83f06dca873281d60168430f06c8de6324
git apply ../grok-cli-control.patch
bun install
bun run typecheck
bun run build
```

## Replicated behavior

The implementation reproduces the native HID framing and RPC rules, random
IDs and ACK correlation, 50 ms serialization, timeout retry, USB/model
preference, reconnect timings, battery refresh, lock suppression, public
connection states, factory colors/effects, four-second selection accent,
voice/snaking precedence, input quiet time, auto-dim, six recent session keys,
last-displayed-assignment routing, exact agent-key double tap, PTT and encoder
timelines, joystick sectors, ACT11 suppression, and deterministic Terminal/iTerm
focus.

Grok-side semantic controls cover session select/fork, submit, guarded
approve/decline, plan toggle, reasoning adjustment, and exact 160 px
conversation scrolling. Plan questions produce the native awaiting-response
state, while approval controls remain guarded to a genuine pending approval.

## Exact compatibility boundary

The following native concepts do not exist in Grok CLI or its xAI runtime:

- Codex FAST mode
- native voice capture/PTT transcription
- Codex composer-highlight navigation
- Codex sidebar and view-history navigation
- the `/settings/codex-micro` screen

They fail explicitly as `unsupported`; the adapter never substitutes a
similar mode or injects guessed terminal keystrokes. This preserves exactness
for every implemented action, but means the full physical surface cannot be
truthfully called 100% feature-complete until Grok gains those product
concepts.

## Verification

- Grok control adapter: TypeScript and build pass; 12 focused tests pass.
- Hardware package: both builds and TypeScript checks pass; 83 tests pass.
- Native framing and lighting fixture snapshots pass.
- `grok-cli-control.patch` applies cleanly to the pinned upstream commit.
- Both worktrees pass `git diff --check`.

Physical USB/Bluetooth smoke testing was not possible in this environment.
Before production use, run `pnpm doctor`, grant macOS Input Monitoring, and
exercise the real device against the acceptance cases in `PARITY.md`.

## Attribution

The daemon derives its MIT-licensed protocol foundation from
[`qGolem/claude-micro`](https://github.com/qGolem/claude-micro). Research also
cross-checked
[`thannous/claude-codex-micro`](https://github.com/thannous/claude-codex-micro)
and [`eliBenven/freemicro`](https://github.com/eliBenven/freemicro). Native
Codex behavior and the included parity fixtures remain the acceptance authority.
