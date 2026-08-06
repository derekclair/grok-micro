# Local control protocol

Interactive Grok sessions expose a local, authenticated control socket for
accessibility tools and hardware control surfaces. Headless runs do not start a
socket. Set `GROK_CONTROL_DISABLE=1` to disable it.

## Discovery and security

Each process writes `~/.grok/control/<pid>.json` with mode `0600`; the directory
is mode `0700`. The record contains protocol version, pid, session id, cwd,
Unix-socket path, a random 256-bit token, and creation time. The socket is mode
`0600`. It also carries a recent-session catalog plus `TERM_PROGRAM`,
`TMUX_PANE`, and tty metadata so a controller can route Agent Keys and focus the
owning terminal without guessing. Treat the discovery record as a secret and
never copy it into a project.

The protocol is versioned NDJSON. A client must authenticate as its first line:

```json
{"version":1,"type":"authenticate","token":"<token from discovery record>"}
```

The server replies with `ready`, then replays a bounded recent event stream.
Every subsequent action carries a caller-selected id:

```json
{"version":1,"type":"action","id":"42","action":{"type":"mode.cycle"}}
```

Results use the same id and return either `ok: true` or a typed error. Important
error codes include `unsupported`, `not_pending`, `not_active`, `busy`, and
`unavailable`. Unsupported actions are never translated to approximate
keystrokes.

## Supported actions

- `composer.submit`
- `turn.interrupt`
- `mode.cycle`
- `composer.togglePlanMode`
- `approval.respond` with `decision: "approve" | "decline"`
- `session.new`
- `thread.select` with `sessionId`
- `thread.fork`
- `reasoning.adjust` with `direction: "increase" | "decrease"`
- `conversation.scroll` with `direction: "up" | "down" | "bottom"`

Thread selection is restricted to the current workspace. Fork creates and
switches to a new persisted session containing the current transcript.

Fast mode, sidebar, back/forward navigation, and settings navigation return
`unsupported` because Grok currently has no exact semantic surface for them.

The focused verification command for this integration is:

```bash
bun run test:control
```

## Events

Authenticated clients receive `event` records with a monotonic `seq`. Current
events cover session open/close/change/catalog, mode changes, turn start/finish,
tool start/finish, and approval/plan-response request and resolution. A plan
question panel emits `input.requested` with `kind: "response"` once when it
opens and the matching resolution once when it closes. `session.catalog` contains
up to six recent active sessions for the current workspace. Selecting, forking,
or starting another session emits `session.changed` but does not close the prior
session; `session.closed` is reserved for process exit or actual deletion.
