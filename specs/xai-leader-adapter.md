# Codex Micro on native xAI Grok Build

**Status**: Draft  
**Owner**: grok-micro  
**Last Updated**: 2026-09-05

## Intent

The Codex Micro pad should drive the **native xAI Grok CLI** the user already runs (`~/.grok/bin/grok`, product name Grok Build TUI), not only the Superagent CLI this repo vendors. Success is: plug in the pad, run ordinary `grok` in a terminal, and Agent Keys / supported factory gestures control **that** visible session—with lighting matching session status—without patching the stock binary and without faking actions as keystrokes.

## Requirements

### Functional

1. A user running stock Grok Build interactively (same OS user, same Grok home) can use the existing grok-micro daemon as the pad bridge. The stock binary is not replaced, wrapped, or required to be the vendored `grok-cli/` tree.
2. The pad continues to mean **six recent sessions for the current workspace**, stable Agent Key slots, lighting = status, factory gesture timings. Those meanings stay as defined in `PARITY.md`; this work does not change HID, colors, or timings.
3. Gestures that Grok Build exposes as an exact control surface are executed against the **TUI-visible** session the user is watching. Gestures with no exact surface are reported as unsupported. Approximate substitutes (typed Enter, prompt preambles that “sort of” toggle a mode) are forbidden.
4. If Grok Build can list sessions but cannot **select or submit on the visible TUI session**, Agent Key select and submit stay unsupported on this backend. Doctor/status must say so. Lights may still reflect whatever session state we can honestly observe; they must not imply select worked.
5. Superagent local control (vendored `grok-cli/` + `~/.grok/control`) remains a supported way to use the pad. This work is additive.
6. Which backend is active is explicit in doctor/`status.sh`: Superagent local-control, Grok Build leader, or neither. No silent fallback.
7. Discovery of Grok Build is hostile-by-default (live process, expected socket, same owner). Tokens, prompts, tool arguments, and model output never appear in health JSON, slot files, or daemon logs.
8. The HID protocol package stays Grok-agnostic. Grok-product specifics stay in the bridge.

### Non-Functional

- **Security**: the daemon must not enable Grok Build auto-approve / yolo. Approve and Reject on the pad fire only when a real pending permission or equivalent prompt exists on a surface we can answer.
- **Privacy**: protocol probes use an isolated Grok home; recordings are gitignored; checked-in fixtures contain no secrets.
- **Compatibility**: first target is the host’s current Grok Build **1.0.13** (`5e9a58528b76`). A newer binary needs a probe replay before we claim mappings still hold.
- **Platform**: macOS-first for this backend (HID + terminal focus already are). Do not claim Linux/Windows Grok Build in v1.
- **Observability**: status distinguishes “pad up, stock TUI up, no leader” from “leader up, this gesture unsupported.”
- **Verify**: Superagent path stays green (`pnpm verify`; Grok control tests when that tree is touched). Grok Build claims need a real TUI + pad note, not unit tests alone.

## Acceptance Criteria

- [ ] Given only stock `~/.grok/bin/grok` TUI running with a live leader, when `status.sh` runs, then doctor reports Grok Build as the session source (or why it is missing) and does not treat leftover Superagent control files as that source.
- [ ] Given a gesture mapped after a 1.0.13 probe, when the user performs it on the pad, then the **visible** Grok TUI session changes accordingly and health `lastAction.ok` is true.
- [ ] Given a gesture with no proven exact surface, when the user performs it, then health records failure as unsupported and the terminal receives no injected keystrokes.
- [ ] Given the Superagent patched CLI as today, when that backend is selected (or auto-selected because control records exist), then existing pad behavior and tests remain green.
- [ ] Given isolated probe recordings, when any fixture is committed, then it contains no tokens, OAuth material, prompts, or tool payloads.
- [ ] All listed requirements are demonstrably met.
- [ ] Non-goals remain out of scope.

## Non-Goals

- Replacing or shadowing `~/.grok/bin/grok` as the interactive UI.
- Vendoring xAI Grok Build sources or copying unofficial TUI internals.
- Making Superagent `grok-cli` impersonate Grok Build.
- Keystroke, PTY, or accessibility injection.
- Mapping FAST, sidebar, back/forward, settings, conversation scroll, or MIC/PTT until an exact Grok Build surface exists.
- Auto-approving tools from the daemon.
- Linux/Windows Grok Build support in v1.
- Removing the vendored Superagent control path in this change.
- Changing `PARITY.md` gesture timings or lighting colors.

## Constraints & Assumptions

- `AGENTS.md` hard invariants still apply: fail closed, no proprietary redistribution, secrets off daemon disk, protocol package purity, macOS-first.
- **Two products share `~/.grok/`**: Superagent CLI (`grok-cli/` in this repo, API key, `~/.grok/control` NDJSON) and xAI Grok Build (`~/.grok/bin/grok` 1.0.13, OAuth, `config.toml`, `leader.sock`). A shared home directory is not a shared control protocol.
- Grok Build documents `grok agent stdio` (Agent Client Protocol) and `grok leader` against `~/.grok/leader.sock`. Stock Grok does not publish Superagent local-control v1.
- Clean-room: public ACP/xAI CLI docs plus probes of the installed 1.0.13 binary. Do not paste unofficial client source.
- Constitution for this repo is `AGENTS.md` + `SECURITY.md` + `PARITY.md`.
- Implementation of the adapter does not start until this Spec is **Approved**. Observation probes that only answer Open Questions may proceed (no daemon behavior change).

## Open Questions

- [ ] **Q1 — TUI identity.** Does loading a session over Grok Build’s public agent interface change the fullscreen `grok` TUI the user is watching, or only a parallel session that happens to share a catalog?
- [ ] **Q2 — Submit.** Does the public prompt/submit surface append to that visible TUI composer, or does the TUI own input exclusively?
- [ ] **Q3 — Approvals.** On 1.0.13, can the pad Approve/Reject the TUI’s pending tool card through a real permission/plan RPC, or does Grok resolve that internally?
- [ ] **Q4 — Fork, plan, reasoning.** Which of those factory gestures have an exact, callable surface on 1.0.13’s public agent interface (vs TUI-only)?
- [ ] **Q5 — Auth.** Does a second local client attaching to the leader need a secret, or is Unix-socket ownership enough?
- [ ] **Q6 — Workspace filter.** Is the session list scoped to the current working directory the way six Agent Keys require?

Q1 and Q2 block Agent Key and Submit on this backend. Q3–Q4 block those individual keys. Probes should answer them before any Plan is Approved.

## Related

- Plan (draft, not approved): `plans/xai-leader-adapter.md`
- Decisions (proposed): `DECISIONS.md`
- Tasks: not created (SDD: after Plan approval)
- Superagent control today: `grok-cli/docs/local-control.md`
- Gesture contract: `PARITY.md`
- Security: `SECURITY.md`
- Public ACP: https://agentclientprotocol.com
- xAI CLI reference: https://docs.x.ai/build/cli/reference
