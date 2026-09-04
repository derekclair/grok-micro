#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "== doctor =="
node "$ROOT/grok-micro/packages/bridge/dist/doctor.js" 2>&1 || true
echo
echo "== health =="
if [[ -f /private/tmp/grok-micro-health.json ]]; then
  python3 - <<'PY'
import json
from pathlib import Path
h=json.loads(Path("/private/tmp/grok-micro-health.json").read_text())
d=h.get("device") or {}
print(f"state={h.get('state')} firmware={d.get('firmware')} battery={d.get('battery')}")
print(f"lastAction={h.get('lastAction')}")
PY
else
  echo "(no health file — daemon not running)"
fi
echo
echo "== control sessions =="
ls -la "$HOME/.grok/control" 2>/dev/null || echo "(none)"
