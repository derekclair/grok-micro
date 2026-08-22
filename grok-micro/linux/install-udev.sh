#!/usr/bin/env bash
# Install hidraw udev rules so the grok-micro daemon can open USB and BLE pads
# without root. Safe to re-run. Does not print device serials or host names.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RULE_SRC="$ROOT/99-grok-micro.rules"
RULE_DST="/etc/udev/rules.d/99-grok-micro.rules"

if [[ "${1:-}" == "uninstall" ]]; then
  sudo rm -f "$RULE_DST"
  sudo udevadm control --reload
  sudo udevadm trigger --subsystem-match=hidraw
  echo "Removed $RULE_DST"
  exit 0
fi

if [[ ! -f "$RULE_SRC" ]]; then
  echo "Missing $RULE_SRC" >&2
  exit 1
fi

sudo install -m 644 "$RULE_SRC" "$RULE_DST"
sudo udevadm control --reload
sudo udevadm trigger --subsystem-match=hidraw
sudo udevadm settle
echo "Installed $RULE_DST — unplug/replug the pad if hidraw is still root-only."
