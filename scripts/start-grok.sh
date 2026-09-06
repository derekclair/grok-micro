#!/usr/bin/env bash
# Launch patched Grok CLI with local control protocol (required for the pad).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/grok-cli"

# Load XAI/GROK API key without printing it.
if [[ -z "${GROK_API_KEY:-}" ]]; then
  for envfile in \
    "${GROK_ENV_FILE:-}" \
    "$HOME/Code/github.com/basement-lab/thelab/.env" \
    "$HOME/.grok/.env"
  do
    [[ -n "$envfile" && -f "$envfile" ]] || continue
    set -a
    # shellcheck disable=SC1090
    source "$envfile"
    set +a
    if [[ -n "${XAI_API_KEY:-}" && -z "${GROK_API_KEY:-}" ]]; then
      export GROK_API_KEY="$XAI_API_KEY"
    fi
    [[ -n "${GROK_API_KEY:-}" ]] && break
  done
fi

if [[ -z "${GROK_API_KEY:-}" ]]; then
  echo "GROK_API_KEY (or XAI_API_KEY in a sourced .env) is required." >&2
  echo "export GROK_API_KEY=... or set GROK_ENV_FILE=/path/to/.env" >&2
  exit 1
fi

cd "$CLI"
if [[ ! -f dist/index.js ]]; then
  echo "Building grok-cli…"
  bun install
  bun run build
fi

echo "Starting patched Grok CLI (control protocol on). Leave this window open."
echo "Workspace: $ROOT"
exec bun run dist/index.js --no-sandbox -d "$ROOT"
