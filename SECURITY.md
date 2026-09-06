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

## Linux hidraw

Without udev, Codex Micro hidraw nodes are often `root:root` mode `0600`, which
blocks the daemon. `grok-micro/linux/99-grok-micro.rules` matches USB by vendor
id and Bluetooth HID by kernel name `0005:303A:*` (BLE hidraw has no USB
parent). The shipped mode `0666` / group `plugdev` matches the Work Louder
Input Linux installer. Install with `sudo ./linux/install-udev.sh`. Do not
commit `udevadm` dumps that include serials or Bluetooth addresses.

## Reporting issues

Open a private security report via GitHub Security Advisories on this repository
when available, or contact the maintainer. Do not file public issues that
include discovery tokens, API keys, or session transcripts.
