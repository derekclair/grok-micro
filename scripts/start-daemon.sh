#!/usr/bin/env bash
# Start the grok-micro HID daemon (Codex Micro ↔ Grok control bridge).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MICRO="$ROOT/grok-micro"
LOG_DIR="${GROK_MICRO_LOG_DIR:-/tmp/grok-micro-logs}"
LOCK="${GROK_MICRO_DEVICE_LOCK:-/private/tmp/grok-micro-device.lock}"
mkdir -p "$LOG_DIR"

if [[ -f "$LOCK" ]]; then
  pid="$(tr -d '[:space:]' < "$LOCK" || true)"
  if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
    echo "grok-micro daemon already running (pid $pid)"
    exit 0
  fi
  rm -f "$LOCK" /private/tmp/grok-micro.sock
fi

cd "$MICRO"
# Prefer node from PATH; avoid asdf pnpm shim issues in non-interactive shells.
nohup node packages/bridge/dist/daemon.js >>"$LOG_DIR/daemon.log" 2>&1 &
echo $! >"$LOG_DIR/daemon.pid"
sleep 1.5
if [[ -f /private/tmp/grok-micro-health.json ]]; then
  node packages/bridge/dist/doctor.js || true
  echo "daemon log: $LOG_DIR/daemon.log"
else
  echo "daemon failed to write health; see $LOG_DIR/daemon.log" >&2
  tail -20 "$LOG_DIR/daemon.log" >&2 || true
  exit 1
fi
