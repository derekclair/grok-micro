# Plan: Codex Micro on native xAI Grok Build

**Spec**: `specs/xai-leader-adapter.md`  
**Status**: Draft (blocked until Spec is Approved; How lives here so it does not pollute the Spec)  
**Last Updated**: 2026-09-05

## Architecture / Design Overview

Keep HID, gesture interpretation, six-slot registry, and lighting on the daemon. Introduce a **session backend** seam:

```text
Codex Micro → native-input + lighting + slots
                 ├─ LocalControlBackend      (existing Superagent NDJSON)
                 └─ GrokBuildLeaderBackend   (new)
                       discover leader.sock → catalog sessions → exact RPCs only
```

Prefer Grok Build’s **documented ACP** (`grok agent --leader stdio`, JSON-RPC lines on stdio). Do not reverse-engineer the TUI’s private leader framing (`ControlPayload`) in v1.

If probes prove ACP cannot drive the **visible TUI** (Spec Q1/Q2), v1 of this backend ships as doctor-visible “leader seen, select/submit unsupported.” A follow-up spike against the leader socket itself would be a **new Spec revision**, still fail-closed, still no PTY injection.

## Key Components / Interfaces

- **Session backend** — discover routes, subscribe to status events, send one native action or return unsupported. Same slot/lighting/`lastAction` callers as today.
- **Local-control implementation** — today’s `grok-control.ts` behavior, unchanged for Superagent CLI.
- **Grok Build implementation** — discover via `grok leader list` + `lstat` on `~/.grok/leader.sock`; catalog via probed session-list RPC or `grok sessions list`; actions via child `grok agent --leader stdio`.
- **Doctor/status** — report backend name and leader liveness separately from leftover Superagent control files.
- **Probe recordings** — gitignored; used to fill the mapping table below before coding mappings.

Proposed homes (bridge only; not protocol package):

| Piece | Location |
| --- | --- |
| Backend interface | `grok-micro/packages/bridge/src/session-backend.ts` |
| Superagent client | `grok-control.ts` implements the interface |
| Grok Build adapter | `grok-build-leader.ts` + `grok-build-acp.ts` |
| Tests / probes | `packages/bridge/test/grok-build-*.ts`; gitignored `recordings/` |

Proposed env: `GROK_MICRO_BACKEND=auto|local-control|grok-build`, `GROK_MICRO_GROK_BIN` (default `~/.grok/bin/grok`), `GROK_MICRO_LEADER_SOCKET` (default `~/.grok/leader.sock`). Auto: Superagent if valid control records exist, else Grok Build if the leader is live.

## Technology & Library Choices

| Choice | Rationale | Alternatives considered |
|--------|-----------|-------------------------|
| ACP stdio to `grok agent --leader` | Public, versioned JSON-RPC; avoids private TUI framing | Direct `leader.sock` binary protocol — only if Q1/Q2 fail |
| Probe-gated method map | Binary strings are not callable methods | Map from `strings` output — rejected |
| Child process + line JSON-RPC in the bridge | Matches documented transport; stderr is logs | Attach undocumented leader `control_v1` frames in v1 |
| Isolated `GROK_HOME` for probes | No secrets in the repo | Probe against the user’s live OAuth home — rejected for fixtures |

## Data Model / State / Process Flow

Slot vocabulary stays `GrokSession` / `GrokSessionState` (`off`, `idle`, `working`, `unread`, `awaiting-approval`, `awaiting-response`, `error`). Grok Build `session/update` (and similar) maps into that vocabulary only where the event meaning is exact; unknown events do not change the light (`state.ts` rule).

Candidate mappings (not requirements — fill pass/fail on 1.0.13 before implementation):

| Native action | Candidate surface | Pre-probe |
| --- | --- | --- |
| `thread.select` | session list + `session/load` | Medium; **Q1** |
| `composer.submit` | `session/prompt` | High only if we own the visible session; **Q2** |
| `approval.*` | `session/request_permission` or equivalent | Low; **Q3** |
| `thread.fork` | `_x.ai/session/fork` / `--fork-session` | Low; **Q4** |
| `reasoning.*` | `session/set_mode` (effort, not plan) | Medium; **Q4** |
| `composer.togglePlanMode` | `_x.ai/toggle_plan_mode` | Likely TUI-only |
| scroll / FAST / sidebar / nav / PTT | none | Unsupported |

xAI extension method names on the wire use a leading `_` (`_x.ai/...`). Treat TUI-only RPCs as unsupported unless a 1.0.13 ACP probe returns a result.

## Sequencing & Dependencies

1. **Observe** (allowed during Draft Spec): isolated `GROK_HOME`, live `grok` TUI, answer Spec Q1–Q4. No daemon feature work. Done when the mapping table has pass/fail for 1.0.13.
2. **Spec Approved** using those answers (update Open Questions in the Spec).
3. **This Plan Approved**, then Tasks.
4. Extract backend interface with Superagent tests still passing.
5. Implement only proven mappings; doctor/status dual-backend.
6. Hardware smoke with stock TUI; update Spec/Plan if reality differs.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| ACP shares catalog but not the visible TUI | High | Agent Keys useless | Spec FR4; ship unsupported rather than fake |
| Permission RPC never fires on 1.0.13 | High | Approve/Reject dead | Leave unsupported; do not auto-approve |
| Grok Build upgrade breaks methods | Medium | Silent wrong actions | Version pin + probe replay |
| Leader socket confused with Superagent control | Medium | Wrong backend | Doctor reports both; hostile discovery |
| Probe recordings leak secrets | Medium | Security invariant | `GROK_HOME` isolation, gitignore, redaction |

## Verification Approach

- Superagent: `cd grok-micro && pnpm verify`; control tests if `grok-cli/src/control` is untouched they need not re-run.
- Grok Build: isolated ACP probe log (gitignored) attached to the mapping table; then USB smoke with stock TUI and `lastAction` in health (no transcripts).
- Doctor fixtures: leftover Superagent health/control files must not count as a live Grok Build leader.

## Open Design Questions

- Direct leader-socket spike: only after Q1/Q2 prove ACP cannot drive the TUI; requires Spec revision.
- Whether `auto` backend should prefer Superagent whenever *any* control file exists, including stale ones (doctor already has stale-health rules — apply the same honesty here).
