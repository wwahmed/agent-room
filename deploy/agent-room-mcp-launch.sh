#!/bin/sh
# T-31 agent-room MCP launch wrapper.
#
# Derives a per-session agent-room endpoint from a STRICT $PWD/.wakichat-agent
# and injects it as AGENT_ROOM_BASE_URL, then execs the real MCP client with
# all args forwarded (server mode AND `hook` mode).
#
# Installed machine-globally via ~/.claude.json, so it runs for EVERY Claude
# session on this host. Safety contract:
#   - Fall through UNCHANGED to the local self-host (8210) unless the config
#     passes EVERY gate below. Unrelated sessions must be untouched.
#   - .wakichat-agent must be a REGULAR file (not a symlink), owned by us,
#     mode 600, and <= 256 bytes.
#   - It must contain EXACTLY ONE non-blank line, and that line must FULLY
#     match the exact endpoint form: a T-31 proxy port (8211-8213) and a
#     /t/<32-hex-token> path. Duplicate/extra lines, arbitrary ports/paths,
#     or any other character => reject (fall through).
#   - The file is NEVER sourced and the value is NEVER eval'd; it is read by
#     awk/grep and passed only through a quoted export. Never print it.
set -eu

DEFAULT_URL="http://127.0.0.1:8210"
CFG="$PWD/.wakichat-agent"
URL="$DEFAULT_URL"

if [ -f "$CFG" ] && [ ! -L "$CFG" ]; then
  perms=$(stat -f '%Lp' "$CFG" 2>/dev/null || echo "x")
  owner=$(stat -f '%u' "$CFG" 2>/dev/null || echo "x")
  size=$(wc -c < "$CFG" 2>/dev/null | tr -d ' \n' || echo 999999)
  [ -n "$size" ] || size=999999
  if [ "$perms" = "600" ] && [ "$owner" = "$(id -u)" ] && [ "$size" -le 256 ]; then
    nlines=$(awk 'NF{c++} END{print c+0}' "$CFG" 2>/dev/null || echo 0)
    if [ "$nlines" = "1" ]; then
      line=$(awk 'NF{print; exit}' "$CFG" 2>/dev/null || true)
      if printf '%s' "$line" | grep -Eq '^AGENT_ROOM_BASE_URL=http://127\.0\.0\.1:(8211|8212|8213)/t/[0-9a-f]{32}$'; then
        URL=${line#AGENT_ROOM_BASE_URL=}
      fi
    fi
  fi
fi

export AGENT_ROOM_BASE_URL="$URL"
exec npx -y agent-room-mcp "$@"
