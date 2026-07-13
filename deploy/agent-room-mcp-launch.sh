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
#   - Config selection: if WAKICHAT_AGENT_FILE is set (a NON-secret absolute
#     path — used by agents whose cwd is shared/ambiguous, e.g. Codex), that
#     fixed file is the config; otherwise the per-session file is the physical
#     cwd's .wakichat-agent, resolved with /bin/pwd -P (ignores a spoofed $PWD
#     so a bogus environment cannot redirect us). Either way EVERY gate below
#     (regular-file/symlink/owner/600/size/one-line/strict-endpoint) applies.
#   - Residual: a same-user TOCTOU exists between the stat gates and the read
#     (another same-uid process could swap the file). This is a bounded
#     same-user residual, accepted and documented rather than contorting
#     POSIX sh; a same-uid attacker already owns the session.
set -eu

DEFAULT_URL="http://127.0.0.1:8210"
if [ -n "${WAKICHAT_AGENT_FILE:-}" ]; then
  CFG="$WAKICHAT_AGENT_FILE"          # fixed-file selector (non-secret path); no cwd dependency
else
  DIR=$(/bin/pwd -P 2>/dev/null) || DIR=$(pwd -P)
  CFG="$DIR/.wakichat-agent"          # per-session, physical-cwd derived
fi
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
# Pin the REGISTRY package explicitly: a bare `npx -y agent-room-mcp` run from
# inside the agent-room monorepo resolves the local workspace package of the
# same name (no bin link) and fails "command not found". --package forces the
# published package + version regardless of cwd.
#
# Defense-in-depth token redaction: the closed 0.25.x client echoes
# AGENT_ROOM_BASE_URL (which carries /t/<token>) inside fetch-error messages,
# which would deposit the token into the agent's transcript. Filter the
# client's stdout, rewriting any /t/<32-hex> to /t/<32 x 'X'> — length
# preserving, and MCP stdio is newline-delimited JSON-RPC (verified), so
# per-line redaction cannot corrupt message framing. stdin is left untouched.
exec npx -y --package=agent-room-mcp@0.25.4 agent-room-mcp "$@" \
  | /usr/bin/perl -pe 'BEGIN{$|=1} s{(/t/)[0-9a-f]{32}}{$1.("X"x32)}ge'
