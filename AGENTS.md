# AGENTS.md

Instructions for AI agents (and humans) working in this repository.

## Status: public on GitHub (pre-release)

**Repository:** https://github.com/derekclair/grok-micro  
**Local path:** `/Users/derekclair/Code/github.com/derekclair/grok-micro`  
**Default branch:** `main` (tracks `origin/main`)  
**Visibility:** public

Code is on GitHub. Treat product maturity as **pre-release** until physical
smoke against a real Codex Micro is done and documented:

- Unit tests pass (`pnpm verify` in `grok-micro/`, control tests in `grok-cli/`)
- **Hardware smoke is still the gate** for calling a given revision “production
  ready” or tagging a release
- Do not invent release notes that claim device-verified parity without a real
  Micro walkthrough

### Remaining next steps

1. **Physical smoke (blocking for “production ready”)**  
   - Connect a Work Louder Codex Micro (USB preferred).  
   - `cd grok-micro && pnpm install && pnpm doctor && pnpm start`  
   - Run patched Grok CLI interactively so `~/.grok/control/<pid>.json` appears.  
   - Exercise: Agent Key select/double-tap focus, approve/decline, fork, submit,
     encoder modes, joystick, ACT11 ignored, lighting states in `PARITY.md`.  
   - Confirm Karabiner / Logitech Options+ are not stealing HID (Work Louder
     documents interference with Micro ↔ host apps).

2. **Post-publish hygiene**  
   - Enable Security Advisories / private vulnerability reporting on GitHub.  
   - Optionally add CI: `grok-micro` → `pnpm verify`; `grok-cli` →
     `bun run typecheck` + `bun test src/control/` (or `bun run test:control`).  
   - Tag `v0.3.0` only after smoke; keep README status honest until then.  
   - Consider whether the vendored full `grok-cli/` tree stays long-term or the
     public story shrinks to `grok-micro/` + `grok-cli-control.patch` only.

3. **Do not push** secrets: discovery tokens, `~/.grok/control/`, API keys,
   session transcripts, or machine-local Input app storage.

### Push workflow (already configured)

```sh
cd /Users/derekclair/Code/github.com/derekclair/grok-micro
git push origin main
```

---

## What this project is

**Grok Micro** is a clean-room interoperability layer that makes a Work Louder
**Codex Micro** (and Creator Micro V2-compatible boards) drive **Grok CLI** the
way the pad drives ChatGPT Codex:

- Six Agent Keys → six recent Grok sessions (stable slots, lighting = status)
- Factory gestures (approve/reject/fork/submit, encoder, joystick, MIC timing)
- Factory lighting palette and connection/reconnect policy
- **Authenticated** local control from daemon → Grok (no guessed terminal
  keystrokes for “almost” features)

It does **not** redistribute proprietary Work Louder/OpenAI firmware, closed
native modules, or Codex app source. Wire shapes and timings come from
observable parity docs (`PARITY.md`, fixtures), not from shipping vendor code.

### Runtime architecture

```text
Grok CLI (interactive)
  └─ LocalControlServer  →  ~/.grok/control/<pid>.json + Unix socket (0600)
         ▲ authenticate + NDJSON events/actions
         │
grok-micro daemon (macOS)
  ├─ discoverControlRoutes()  (owner, mode, PID, token checks)
  ├─ six-session registry + lighting policy
  └─ node-hid → vendor page 0xFF00 / report id 6 / RPC channel 2
         ↕
     Codex Micro hardware
```

Fallback path: hooks installer merges a lighting-only hook into
`~/.grok/user-settings.json` when Grok has no control socket — **no** action
route in that mode.

---

## Repository map

| Path | Role |
| --- | --- |
| `grok-micro/` | pnpm workspace: `packages/protocol` (pure codec) + `packages/bridge` (daemon, doctor, install, tools) |
| `grok-micro/packages/bridge/dist/` | **Committed** JS for clone-and-run hooks/daemon without a build step; rebuild after bridge edits |
| `grok-micro/packages/protocol/dist/` | **Not** committed (gitignored); produced on `pnpm install` / build |
| `grok-cli/` | Vendored Grok CLI + **local control protocol v1** (`src/control/`) |
| `grok-cli-control.patch` | Same Grok control delta against upstream commit `fb97af83f06dca873281d60168430f06c8de6324` |
| `PARITY.md` | Native behavioral contract (authority for HID/lighting/gestures) |
| `native-parity-fixtures.json` | Executable acceptance data |
| `SECURITY.md` | Control-plane secrets and reporting |
| `LICENSE` / `grok-micro/ATTRIBUTION.md` | MIT + qGolem lineage |

Pinned upstream for the patch path:

```text
https://github.com/superagent-ai/grok-cli @ fb97af83f06dca873281d60168430f06c8de6324
```

---

## Hard invariants (do not violate)

1. **Fail closed on unsupported actions.** Map only exact Grok control actions.
   Never inject approximate keystrokes for FAST, voice PTT, sidebar, composer
   highlight nav, settings, etc. Use `unsupported` / `UnsupportedActionError`.

2. **No proprietary redistribution.** Do not vendor Work Louder Input app
   sources, asar extracts, or Codex proprietary packages. Parity constants stay
   in docs/fixtures/tests as interoperability facts.

3. **Secrets stay off disk in the daemon.** Tokens live in memory only after
   discovery read. Slot files and health JSON must never include tokens,
   prompts, tool args, or model output.

4. **Discovery is hostile-by-default.** Only accept records with protocol v1,
   absolute socket path, owner match, modes `0700` dir / `0600` file+socket,
   live PID, and sufficient token length. Constant-time token compare on auth.

5. **Native gesture/lighting parity.** Change timings, colors, or state
   precedence only with an update to `PARITY.md` + tests/fixtures. Key constants
   include: 50 ms request pacing, 10 s ACK + one retry, IDs `0..998`, 350 ms
   agent double-tap / MIC rules, 500 ms encoder long-press, joystick ≥0.5, ACT11
   ignored, 4 s selection accent, factory RGB table in `PARITY.md`.

6. **Preserve protocol package purity.** `packages/protocol` stays dependency-
   free and Grok-agnostic. Grok-specific routing belongs in `packages/bridge`.

7. **Do not expose** `sys.bootloader` or firmware filesystem write APIs.

8. **macOS-first.** Bridge depends on HID + Terminal/iTerm focus helpers. Do not
   casually claim Linux/Windows support without implementing and testing it.

---

## Toolchain and commands

| Area | Toolchain |
| --- | --- |
| `grok-micro/` | Node ≥20, **pnpm** `9.15.9` (`packageManager` field) |
| `grok-cli/` | **Bun** (install + test + typecheck); build emits `dist/` for `node` |

### Daemon (`grok-micro/`)

```sh
cd grok-micro
pnpm install          # builds packages (prepare)
pnpm verify           # build + tsc --noEmit + tests (required before claiming green)
pnpm start            # packages/bridge/dist/daemon.js
pnpm doctor
pnpm install-hooks    # optional degraded lighting hooks
pnpm uninstall-hooks
```

Useful env vars (defaults in `grok-micro/README.md`):

- `GROK_MICRO_CONTROL_DIR` → `~/.grok/control`
- `GROK_MICRO_SOCKET` / `GROK_MICRO_SLOTS` / `GROK_MICRO_HEALTH`
- `GROK_MICRO_BRIGHTNESS`, `GROK_MICRO_AUTO_OFF_MS`
- `GROK_MICRO_ENCODER_MODE`, `GROK_MICRO_SINGLE_TAP_FOCUS`

After editing bridge **source**, rebuild so committed `dist/` stays current:

```sh
cd grok-micro && pnpm --filter grok-micro-bridge build
# include updated packages/bridge/dist/* in the same commit as src changes
```

### Grok CLI (`grok-cli/`)

```sh
cd grok-cli
bun install
bun run typecheck
bun run build
node dist/index.js
# control-plane focus:
bun test src/control/
# or:
bun run test:control
```

Control docs: `grok-cli/docs/local-control.md`.  
Disable control socket: `GROK_CONTROL_DISABLE=1`.

Interactive sessions only publish discovery; headless runs do not start a
control server unless the product code says otherwise — do not “fix” that
without reading `src/control/` + call sites in `src/index.ts` / UI.

### Patch workflow (upstream Grok)

```sh
git clone https://github.com/superagent-ai/grok-cli.git
cd grok-cli
git checkout fb97af83f06dca873281d60168430f06c8de6324
git apply /path/to/this-repo/grok-cli-control.patch
```

If you change `grok-cli/src/control/**` (or related wiring), regenerate or update
`grok-cli-control.patch` so the patch path stays equivalent to the vendored tree.
State the new upstream pin in README/`AGENTS.md` if you move the base commit.

---

## Where to edit (by task)

| Goal | Primary locations |
| --- | --- |
| HID framing / RPC / lighting wire types | `grok-micro/packages/protocol/src/` |
| Device open, reconnect, daemon loop | `grok-micro/packages/bridge/src/daemon.ts`, `micro.ts` |
| Gesture state machines | `native-input.ts` |
| Status → RGB policy | `status-lighting.ts` |
| Six-session registry / routes | `state.ts` |
| Grok discovery + NDJSON client | `grok-control.ts` |
| Terminal focus | `focus.ts`, `focus-state.ts` |
| Hook install merge | `install.ts` |
| Diagnostics | `doctor.ts`, `device-health.ts` |
| Grok control server / types / UI actions | `grok-cli/src/control/` |
| Control doc for humans | `grok-cli/docs/local-control.md` |
| Parity authority | `PARITY.md`, `native-parity-fixtures.json` |

---

## Testing expectations

Before finishing a non-trivial change:

1. `cd grok-micro && pnpm verify` — expect protocol + bridge tests green
   (historically ~53 + ~30).  
2. If control protocol or Grok UI actions changed:
   `cd grok-cli && bun run typecheck && bun test src/control/`.  
3. Prefer extending existing tests over manual-only verification.  
4. Do not claim hardware parity without real-device notes; unit green ≠ Micro green.

---

## Security and privacy (agent checklist)

- Never commit or log `~/.grok/control/*` contents.  
- Never add telemetry that captures prompts, tool args, or completions in the
  daemon.  
- Prefer `SECURITY.md` language when documenting auth.  
- Input Monitoring is required on macOS; document it, do not bypass via
  unsupported private APIs.

---

## Attribution and licensing

- MIT overall; see root `LICENSE`.  
- Protocol foundation and claude-micro lineage: **qGolem** (preserve notices).  
- Grok CLI base: **Superagent AI** / upstream contributors.  
- Grok Micro adaptations: **Derek Clair** and contributors.  

When copying patterns from freemicro / claude-codex-micro research trees, keep
this tree clean-room: ideas and observed constants are fine; do not paste
proprietary extracts.

---

## Communication style for agents in this repo

- Prefer small, reviewable commits; do not rewrite the vendored Grok CLI wholesale
  unless the task is an intentional upstream sync.  
- When behavior changes, update `PARITY.md` and tests in the same change set.  
- Call out **unsupported** surfaces explicitly in README/daemon health rather
  than silent no-ops.  
- Keep status badges/docs honest while **pre-release** and pre-smoke.

---

## Quick “am I in the right place?” check

You are working on the correct problem if the change improves **Codex Micro ↔
Grok CLI** interoperability (HID, lighting, gestures, control protocol, or
docs/security around that). If the request is general Grok CLI feature work
unrelated to the pad, prefer contributing upstream to
`superagent-ai/grok-cli` and only carry a minimal delta here.
