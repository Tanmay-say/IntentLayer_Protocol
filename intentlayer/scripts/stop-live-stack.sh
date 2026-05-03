#!/usr/bin/env bash
set -euo pipefail

PIDS=(
  /tmp/axl-a.pid
  /tmp/axl-b.pid
  /tmp/axl-observer.pid
  /tmp/axl-mock.pid
  /tmp/intentlayer-observer.pid
  /tmp/intentlayer-agent-b.pid
  /tmp/intentlayer-admin-api.pid
  /tmp/intentlayer-admin-web.pid
)

for file in "${PIDS[@]}"; do
  if [[ ! -f "$file" ]]; then
    continue
  fi
  pid="$(cat "$file")"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
done

pkill -f "@intentlayer/axl-mock start" 2>/dev/null || true
pkill -f "pnpm agent:observer" 2>/dev/null || true
pkill -f "pnpm agent:b" 2>/dev/null || true
pkill -f "pnpm admin:api" 2>/dev/null || true
pkill -f "pnpm admin:web" 2>/dev/null || true

echo "IntentLayer local stack stopped."
