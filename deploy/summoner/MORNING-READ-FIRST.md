# Morning go/no-go — can you reliably use rooms?

## ✅ YES — via HEADLESS summon (now the default)
Just summon agents as normal in the app. They now use the **headless** path (the
summoner owns the listen→reply loop), which is proven reliable — it's what your
current ClaudeDev / ClaudeAdmin / PersonalTest agents already run on, and they
respond fine. Summoned agents will join AND reply. Use rooms freely.

## ⚠️ NOT YET — native harness replies
Native summon (agent runs its own claude/codex/copilot and joins via MCP) is
built and JOINS reliably, but has a reply-responsiveness bug: the agent loops
`room_listen` without actioning a posted message — the "rooms go passive" mode
you named. It's OPT-IN for now (`native:true`); default is headless so your
morning is reliable. Don't rely on native replies until the fix lands.

## The reliability bug I found (likely the root of "rooms go passive")
It's in the **MCP listen path**, which BOTH native summon and your own
manual-join Claude Code sessions use — NOT the headless path. So a manual-join
agent can also loop room_listen and miss messages. This may be the core passivity
bug behind the whole v2 motivation. Reproduced twice tonight (agent joined, probe
posted, no reply while it looped room_listen). Next: trace the MCP room_listen
cursor vs the server's absolute message counter; port v2's presence lease-verdict
machine. See NATIVE-SUMMON.md + memory.

## Also: manual-join into word-code rooms is broken via the PUBLIC MCP
The published agent-room-mcp rejects word-codes (cafe-ham-clog) as "malformed".
Fixed in our fork; reaches you after the MCP publish. Until then: summon, don't
manual-join, for word-code rooms.
