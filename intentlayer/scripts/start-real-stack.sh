#!/usr/bin/env bash
# IntentLayer — foreground real-AXL orchestrator.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RESET=$'\033[0m'
C_AXL=$'\033[38;5;208m'
C_OBS=$'\033[38;5;81m'
C_B=$'\033[38;5;141m'
C_API=$'\033[38;5;82m'
C_WEB=$'\033[38;5;220m'

prefix() {
  local label="$1" colour="$2"
  sed -u "s/^/${colour}[${label}]${RESET} /"
}

if ! command -v axl >/dev/null 2>&1; then
  echo "axl binary not found. Run ./scripts/install-axl.sh and ensure ~/.local/bin is on PATH." >&2
  exit 1
fi

chmod +x scripts/stop-live-stack.sh scripts/start-axl.sh
echo "Stopping any prior IntentLayer stack ..."
scripts/stop-live-stack.sh > /dev/null 2>&1 || true

rm -f /tmp/intentlayer-events.jsonl

CHILD_PIDS=()

cleanup() {
  echo ""
  echo "Shutting down IntentLayer stack ..."
  for pid in "${CHILD_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  scripts/stop-live-stack.sh > /dev/null 2>&1 || true
  echo "Stack stopped."
}

trap cleanup EXIT INT TERM

scripts/start-axl.sh

for log_file in /tmp/axl-a.log /tmp/axl-b.log /tmp/axl-observer.log; do
  label="$(basename "$log_file" .log)"
  tail -f "$log_file" 2>/dev/null | prefix "$label" "$C_AXL" &
  CHILD_PIDS+=($!)
done

sleep 1

{ pnpm agent:observer 2>&1 | prefix "observer" "$C_OBS"; } &
CHILD_PIDS+=($!)

sleep 0.5

{ pnpm agent:b 2>&1 | prefix "agent-b " "$C_B"; } &
CHILD_PIDS+=($!)

sleep 0.5

{ pnpm admin:api 2>&1 | prefix "api     " "$C_API"; } &
CHILD_PIDS+=($!)

sleep 0.5

{ pnpm admin:web 2>&1 | prefix "web     " "$C_WEB"; } &
CHILD_PIDS+=($!)

cat <<'BANNER'

IntentLayer real stack
  AXL A      http://127.0.0.1:7701
  AXL B      http://127.0.0.1:7702
  Observer   http://127.0.0.1:7703
  Admin API  http://127.0.0.1:8787
  Dashboard  http://127.0.0.1:3000

Press Ctrl-C to stop all processes.

BANNER

wait
