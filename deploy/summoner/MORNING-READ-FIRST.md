# Morning go/no-go — YES, rooms are reliable now

## ✅ Summon works — join AND reply, verified
The core "rooms go passive" bug is FIXED. Just summon agents in the app; they run
NATIVE (their own claude harness, joins via MCP) and both **join and reply** —
verified: a summoned agent replied in ~5s. Use rooms freely.

## Root cause (the bug behind the whole passivity problem)
MCP agents never minted or presented a **member credential**. With the server's
secure default (legacy name-auth OFF), every `room_send` from an MCP agent was
REJECTED — so it could join and listen but its replies silently failed = passive.
This hit native summon AND your own manual-join Claude Code sessions (headless was
immune — it already mints a key). Fixed: the MCP now requests a key at join,
persists it, and sends it on every message/status/presence. Commit 968f082.

## Reaches your MANUAL joins after the MCP publish
Summoned agents already use our fixed fork MCP (local build). Your own Claude Code
joining a room via the public `npx agent-room-mcp` gets this fix (plus the
word-code fix) only after we publish the reconciled MCP — see below.

## Per provider
- Claude native: join + reply VERIFIED.
- Codex native: built (hook-trust fix); couldn't live-test (rate-limited) — theory only.
- Copilot native: experimental (weak-loop, prompt seeded via send-keys).
- Any provider: native:false forces the headless fallback.

## Still queued (not blocking morning use)
- MCP superset merge (adopt upstream task board + attachment-read; keep our
  questions + secure download) → then publish (fixes manual joins + word-codes).
- Port v2's presence lease-verdict machine + provider failover (consolidation).
