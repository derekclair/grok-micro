# Decisions

Living ADR-lite log for grok-micro. Newest first.

---

# Decision: Additive Grok Build backend; keep Superagent local-control

**Date**: 2026-09-05  
**Status**: Proposed  
**Related Spec / Plan**: `specs/xai-leader-adapter.md`, `plans/xai-leader-adapter.md`

## Context

The pad today talks only to Superagent Grok CLI’s local-control socket. The user also runs native xAI Grok Build (`~/.grok/bin/grok`). Those are different products that share a `~/.grok/` directory.

## Decision

Ship Grok Build support as a **second session backend**. Do not remove or emulate Superagent local-control in this initiative.

## Rationale

The Superagent path is already USB-smoked. Native Grok Build is unproven (TUI identity, submit, approvals). Additive backends isolate risk and match Spec FR5.

## Alternatives Considered

- Replace Superagent control with Grok Build only — loses a working pad path.
- Teach vendored `grok-cli/` to speak Grok Build’s protocol — wrong product, large unrelated rewrite.

## Consequences

Doctor must show which backend is live. Auto-selection rules belong in the Plan, not the Spec.

---

# Decision: Public ACP first; no PTY injection; no private TUI framing in v1

**Date**: 2026-09-05  
**Status**: Proposed  
**Related Spec / Plan**: `specs/xai-leader-adapter.md`, `plans/xai-leader-adapter.md`

## Context

Grok Build has a leader Unix socket (`control_v1`) for TUI multiplex and a documented ACP stdio agent. Fail-closed is a repo invariant.

## Decision

v1 talks to Grok Build only through **documented ACP** (and probed extensions that actually return results). Do not inject keystrokes. Do not reverse-engineer private leader frames unless a later Spec says ACP cannot drive the visible TUI.

## Rationale

ACP is the supported integration surface. Binary strings and unofficial TUI RPCs are not a contract. Keystrokes violate `AGENTS.md`.

## Alternatives Considered

- Map pad keys to terminal input — rejected (fail-closed).
- Implement `ControlPayload` / private leader RPC in v1 — rejected until Q1/Q2 fail.

## Consequences

Some factory keys (plan toggle, maybe approvals) may stay unsupported on Grok Build even if the TUI has the feature.

---

# Decision: Probe-gated gesture map on pinned Grok Build 1.0.13

**Date**: 2026-09-05  
**Status**: Proposed  
**Related Spec / Plan**: `specs/xai-leader-adapter.md`

## Context

A method name in the Grok Build binary does not mean ACP clients can call it.

## Decision

No native action is mapped until a probe against **1.0.13 (`5e9a58528b76`)** shows a successful exact RPC. Newer binaries need a replay. Candidate tables in the Plan are not requirements.

## Rationale

Matches Spec FR3 and compatibility NFR. Prevents “almost” mappings.

## Alternatives Considered

- Trust `strings` / older 0.2.x unofficial notes as the map — rejected.

## Consequences

Observation phase can run before Spec approval (no daemon behavior change). Implementation waits on Spec + Plan approval.
