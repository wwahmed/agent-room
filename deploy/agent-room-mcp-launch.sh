#!/bin/sh
# T-31 agent-room MCP launch wrapper.
#
# Derives a per-session agent-room endpoint from a strict $PWD/.wakichat-agent
# and injects it as AGENT_ROOM_BASE_URL, then execs the real MCP client with
# all args forwarded (server mode AND `hook` mode).
#
# Safety contract (installed machine-globally via ~/.claude.json, so it runs
# for EVERY Claude session on this host):
#   - Fall through UNCHANGED to the local self-host (8210) when the config
#     file is absent or fails ANY validation gate. Unrelated sessions on this
#     machine must be untouched.
#   - .wakichat-agent must be a REGULAR file (not a symlink), owned by us,
#     mode 600. The endpoint is read by targeted grep (the file is NEVER
#     sourced) and must be a loopback URL.
#   - Never print the endpoint or token.
set -eu

DEFAULT_URL="http://127.0.0.1:8210"
CFG="$PWD/.wakichat-agent"
URL=""

if [ -f "$CFG" ] && [ ! -L "$CFG" ]; then
  perms=$(stat -f '%Lp' "$CFG" 2>/dev/null || echo "")
  owner=$(stat -f '%u' "$CFG" 2>/dev/null || echo "")
  if [ "$perms" = "600" ] && [ "$owner" = "$(id -u)" ]; then
    val=$(grep -E '^AGENT_ROOM_BASE_URL=' "$CFG" 2>/dev/null | tail -1 | cut -d= -f2- || true)
    case "$val" in
      http://127.0.0.1:*|http://localhost:*) URL="$val" ;;
    esac
  fi
fi

[ -n "$URL" ] || URL="$DEFAULT_URL"
export AGENT_ROOM_BASE_URL="$URL"
exec npx -y agent-room-mcp "$@"
