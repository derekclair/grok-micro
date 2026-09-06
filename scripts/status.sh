#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HEALTH="${GROK_MICRO_HEALTH:-/private/tmp/grok-micro-health.json}"
echo "== doctor =="
node "$ROOT/grok-micro/packages/bridge/dist/doctor.js" 2>&1 || true
echo
echo "== health =="
if [[ -f "$HEALTH" ]]; then
  HEALTH_PATH="$HEALTH" python3 - <<'PY'
import json, os
from pathlib import Path
path = Path(os.environ["HEALTH_PATH"])
h = json.loads(path.read_text())
d = h.get("device") or {}
pid = h.get("pid")
live = False
if isinstance(pid, int) and pid > 0:
    try:
        os.kill(pid, 0)
        live = True
    except OSError:
        live = False
updated = h.get("updatedAt")
if live:
    print(f"live pid={pid} updatedAt={updated}")
else:
    print(f"STALE — leftover snapshot (daemon not running); last write {updated}")
print(f"state={h.get('state')} firmware={d.get('firmware')} battery={d.get('battery')}")
action = h.get("lastAction")
print(f"lastAction={action if action is not None else 'null (no pad action recorded yet)'}")
PY
else
  echo "(no health file — daemon not running)"
fi
echo
echo "== control sessions =="
echo "(one discovery file per Grok CLI process; doctor counts live thread IDs inside those files)"
ls -la "$HOME/.grok/control" 2>/dev/null || echo "(none)"
