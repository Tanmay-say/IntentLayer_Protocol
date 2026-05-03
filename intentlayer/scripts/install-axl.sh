#!/usr/bin/env bash
# Install the real Gensyn AXL Go binary.
# Idempotent: skips clone if dir exists; rebuilds binary every run.
set -euo pipefail

if ! command -v go >/dev/null 2>&1; then
  echo "ERROR: go toolchain not found. Install Go >= 1.21 first." >&2
  echo "  apt: sudo apt-get install -y golang"                    >&2
  echo "  brew: brew install go"                                  >&2
  exit 1
fi

AXL_REPO="${AXL_REPO:-https://github.com/gensyn-ai/axl.git}"
AXL_DIR="${AXL_DIR:-$HOME/.cache/gensyn-axl}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"

mkdir -p "$BIN_DIR"

if [ ! -d "$AXL_DIR/.git" ]; then
  echo ">> cloning AXL into $AXL_DIR"
  git clone --depth 1 "$AXL_REPO" "$AXL_DIR"
else
  echo ">> updating $AXL_DIR"
  git -C "$AXL_DIR" pull --ff-only
fi

echo ">> building axl binary"
( cd "$AXL_DIR" && go build -o "$BIN_DIR/axl" ./cmd/axl )

echo ">> installed: $("$BIN_DIR/axl" --version 2>/dev/null || echo "$BIN_DIR/axl")"
echo ">> PATH check:"
case ":$PATH:" in
  *":$BIN_DIR:"*) echo "   $BIN_DIR is already in PATH" ;;
  *) echo "   add to PATH:  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
