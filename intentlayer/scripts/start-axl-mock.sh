#!/usr/bin/env bash
# Start the in-process AXL HTTP mock for dev/CI when the real Go binary is unavailable.
# Spawns a single Node process emulating two daemons (A on 7701, B on 7702).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"

cd "$HERE"
echo ">> starting axl-mock (A=7701, B=7702, Observer=7703)"
setsid nohup pnpm --filter @intentlayer/axl-mock start > /tmp/axl-mock.log 2>&1 < /dev/null &
echo $! > /tmp/axl-mock.pid
sleep 1
echo ">> pid: $(cat /tmp/axl-mock.pid)"
echo ">> log: tail -f /tmp/axl-mock.log"
