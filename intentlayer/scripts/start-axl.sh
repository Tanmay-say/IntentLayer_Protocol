#!/usr/bin/env bash
# Start three AXL daemons in the background. Logs to /tmp/axl-{a,b,observer}.log.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$HERE/.axl-data/a" "$HERE/.axl-data/b" "$HERE/.axl-data/observer"

echo ">> starting Agent A AXL on http://127.0.0.1:7701"
nohup axl --config "$HERE/infra/axl-a.toml" > /tmp/axl-a.log 2>&1 &
echo $! > /tmp/axl-a.pid

echo ">> starting Agent B AXL on http://127.0.0.1:7702"
nohup axl --config "$HERE/infra/axl-b.toml" > /tmp/axl-b.log 2>&1 &
echo $! > /tmp/axl-b.pid

echo ">> starting Observer AXL on http://127.0.0.1:7703"
nohup axl --config "$HERE/infra/axl-observer.toml" > /tmp/axl-observer.log 2>&1 &
echo $! > /tmp/axl-observer.pid

sleep 1
echo ">> A pid: $(cat /tmp/axl-a.pid)   B pid: $(cat /tmp/axl-b.pid)   Observer pid: $(cat /tmp/axl-observer.pid)"
echo ">> tail logs:  tail -f /tmp/axl-a.log  /tmp/axl-b.log  /tmp/axl-observer.log"
