#!/bin/sh
# Install the exact registry MCP used by WakiChat, then apply the bounded local
# word-code attachment patch. New agent sessions pick this runtime through the
# launch wrapper; the registry fallback remains available if install is absent.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RUNTIME_ROOT=${AGENT_ROOM_MCP_RUNTIME_ROOT:-"$HOME/.local/share/wakichat/agent-room-mcp"}
RUNTIME_FILE="$RUNTIME_ROOT/node_modules/agent-room-mcp/dist/index.js"

mkdir -p "$RUNTIME_ROOT"
npm install --prefix "$RUNTIME_ROOT" --omit=dev --ignore-scripts --no-package-lock --no-save agent-room-mcp@0.25.4
node "$SCRIPT_DIR/patch-agent-room-mcp-runtime.mjs" "$RUNTIME_FILE"
node --check "$RUNTIME_FILE"
echo "Installed patched WakiChat MCP runtime at $RUNTIME_FILE"
