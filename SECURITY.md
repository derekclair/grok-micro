# Security

## Control-plane secrets

Grok CLI publishes authenticated discovery records under `~/.grok/control/`:

- directory mode `0700`
- record and Unix socket mode `0600`
- random per-process token (treat as secret)

The Micro daemon validates ownership, modes, live PID, protocol version, and
token before connecting. Tokens are never written to the slot file or logs.

Do **not** commit, paste, or sync `~/.grok/control/` into a project or chat.

## macOS permissions

The daemon needs **Input Monitoring** (and a connected Work Louder device) to
open the vendor HID interface. Prefer running the daemon under the same user as
the interactive Grok session.

## Reporting issues

Open a private security report via GitHub Security Advisories on this repository
when available, or contact the maintainer. Do not file public issues that
include discovery tokens, API keys, or session transcripts.
