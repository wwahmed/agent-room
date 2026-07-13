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
#   - It must be EXACTLY ONE record (one line, optional trailing LF): a file
#     like "valid\n\n" or "valid\n   \n" is rejected, not tolerated.
#   - That record must FULLY match the exact endpoint form: a T-31 proxy port
#     (8211-8213) and a /t/<32-hex-token> path. Arbitrary ports/paths or any
#     other character => reject (fall through).
#   - The file is NEVER sourced and the value is NEVER eval'd; it is read by
#     awk/grep and passed only through a quoted export. Never print it.
#   - The session dir is resolved with the physical cwd (/bin/pwd -P), which
#     ignores a spoofed $PWD, so a bogus environment cannot redirect us to a
#     config in another directory.
#   - Residual: a same-user TOCTOU exists between the stat gates and the read
#     (another same-uid process could swap the file). This is a bounded
#     same-user residual, accepted and documented rather than contorting
#     POSIX sh; a same-uid attacker already owns the session.
set -eu

DEFAULT_URL="http://127.0.0.1:8210"
DIR=$(/bin/pwd -P 2>/dev/null) || DIR=$(pwd -P)
CFG="$DIR/.wakichat-agent"
URL="$DEFAULT_URL"

if [ -f "$CFG" ] && [ ! -L "$CFG" ]; then
  perms=$(stat -f '%Lp' "$CFG" 2>/dev/null || echo "x")
  owner=$(stat -f '%u' "$CFG" 2>/dev/null || echo "x")
  size=$(wc -c < "$CFG" 2>/dev/null | tr -d ' \n' || echo 999999)
  [ -n "$size" ] || size=999999
  if [ "$perms" = "600" ] && [ "$owner" = "$(id -u)" ] && [ "$size" -le 256 ]; then
    total=$(awk 'END{print NR+0}' "$CFG" 2>/dev/null || echo 0)
    if [ "$total" = "1" ]; then
      line=$(awk 'NR==1{print; exit}' "$CFG" 2>/dev/null || true)
      if printf '%s' "$line" | grep -Eq '^AGENT_ROOM_BASE_URL=http://127\.0\.0\.1:(8211|8212|8213)/t/[0-9a-f]{32}$'; then
        URL=${line#AGENT_ROOM_BASE_URL=}
      fi
    fi
  fi
fi

export AGENT_ROOM_BASE_URL="$URL"
exec npx -y agent-room-mcp "$@"
