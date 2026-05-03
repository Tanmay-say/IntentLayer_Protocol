#!/usr/bin/env bash
# IntentLayer — foreground mock-AXL orchestrator
# All services run as child jobs of this shell.
# Ctrl-C (SIGINT) or SIGTERM cleanly kills every child.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── ANSI colour helpers ────────────────────────────────────────────────────────
# $'\033' is required — bash does NOT interpret \033 inside double-quoted strings
RESET=$'\033[0m'
C_AXL=$'\033[38;5;208m'   # orange
C_OBS=$'\033[38;5;81m'    # sky-blue
C_B=$'\033[38;5;141m'     # lavender
C_API=$'\033[38;5;82m'    # lime-green
C_WEB=$'\033[38;5;220m'   # gold

prefix() {
  local label="$1" colour="$2"
  # prefix every line from stdin with a coloured tag
  sed -u "s/^/${colour}[${label}]${RESET} /"
}

# ── Kill any stale prior run ───────────────────────────────────────────────────
chmod +x scripts/stop-live-stack.sh scripts/start-axl-mock.sh
echo "Stopping any prior IntentLayer stack ..."
scripts/stop-live-stack.sh > /dev/null 2>&1 || true

rm -f /tmp/intentlayer-events.jsonl

# ── Cleanup trap — runs on EXIT so Ctrl-C is always clean ─────────────────────
CHILD_PIDS=()

cleanup() {
  echo ""
  echo "Shutting down IntentLayer stack ..."
  for pid in "${CHILD_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  # Belt-and-suspenders: also pkill by name
  pkill -f "axl-mock" 2>/dev/null || true
  pkill -f "observer-agent" 2>/dev/null || true
  pkill -f "agent-b" 2>/dev/null || true
  pkill -f "admin-api" 2>/dev/null || true
  pkill -f "admin-web" 2>/dev/null || true
  echo "Stack stopped. Goodbye."
}

trap cleanup EXIT INT TERM

# ── Start AXL mock (background daemon, still needed as transport layer) ────────
scripts/start-axl-mock.sh > /tmp/axl-mock.log 2>&1 &
AXL_PID=$!
CHILD_PIDS+=("$AXL_PID")

# Tail the axl-mock log with a prefix so it merges into terminal
tail -f /tmp/axl-mock.log 2>/dev/null | prefix "axl-mock" "$C_AXL" &
CHILD_PIDS+=($!)

sleep 1   # let AXL mock bind its ports before agents connect

# ── Start observer agent ────────────────────────────────────────────────────────
{ pnpm agent:observer 2>&1 | prefix "observer" "$C_OBS"; } &
CHILD_PIDS+=($!)

sleep 0.5

# ── Start agent B (long-running listener) ──────────────────────────────────────
{ pnpm agent:b 2>&1 | prefix "agent-b " "$C_B"; } &
CHILD_PIDS+=($!)

sleep 0.5

# ── Start admin API ─────────────────────────────────────────────────────────────
{ pnpm admin:api 2>&1 | prefix "api     " "$C_API"; } &
CHILD_PIDS+=($!)

sleep 0.5

# ── Start admin web (Vite dev server) ──────────────────────────────────────────
{ pnpm admin:web 2>&1 | prefix "web     " "$C_WEB"; } &
CHILD_PIDS+=($!)

# ── Ready banner ──────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║     IntentLayer live stack — foreground mode             ║"
echo "║                                                          ║"
echo "║  AXL mock   http://127.0.0.1:7701-7703                   ║"
echo "║  Admin API  http://127.0.0.1:8787                        ║"
echo "║  Dashboard  http://127.0.0.1:3000                        ║"
echo "║                                                          ║"
echo "║  Press Ctrl-C to stop all processes.                     ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── Stay foreground — wait for all child jobs ────────────────────────────────
wait
