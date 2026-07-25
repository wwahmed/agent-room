#!/bin/sh
# One-time setup: log the SUMMONED-AGENT Claude lane into your CORPORATE account.
#
# Summoned Claude agents authenticate from a dedicated config dir
# (~/.agent-room/claude-agents), completely separate from your personal
# `claude` CLI (~/.claude). Run this once, sign in with your CORPORATE account,
# and every summoned Claude agent runs on corporate compute — your personal CLI
# is never touched. Re-run any time to switch the agent lane's account.
set -eu
export CLAUDE_CONFIG_DIR="$HOME/.agent-room/claude-agents"
mkdir -p "$CLAUDE_CONFIG_DIR"
echo "→ Logging the AGENT Claude lane into a SEPARATE account."
echo "  Config dir: $CLAUDE_CONFIG_DIR   (your personal ~/.claude is untouched)"
echo "  Sign in with your CORPORATE / OpenText account when prompted."
echo
exec claude auth login
