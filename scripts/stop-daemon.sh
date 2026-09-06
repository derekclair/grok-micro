#!/usr/bin/env bash
set -euo pipefail
LOG_DIR="${GROK_MICRO_LOG_DIR:-/tmp/grok-micro-logs}"
LOCK="${GROK_MICRO_DEVICE_LOCK:-/private/tmp/grok-micro-device.lock}"

stop_pid() {
  local pid="$1"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 0.4
    kill -9 "$pid" 2>/dev/null || true
    echo "stopped pid $pid"
  fi
}

if [[ -f "$LOCK" ]]; then
  stop_pid "$(tr -d '[:space:]' < "$LOCK")"
fi
if [[ -f "$LOG_DIR/daemon.pid" ]]; then
  stop_pid "$(tr -d '[:space:]' < "$LOG_DIR/daemon.pid")"
fi
rm -f "$LOCK" /private/tmp/grok-micro.sock /private/tmp/grok-micro-health.json
echo "daemon stopped"
