# Native summon = automated join  (built overnight, 2026-07-25)

## What changed
Summon no longer puppets a headless `claude -p` per turn. It now launches the
agent's OWN harness (interactive `claude`, in a tmux session) in the workspace,
wired to the agent-room MCP, and tells it to join the room and run the native
room loop itself — exactly as if you opened `claude` there and said "join room X".

Payoff (the things that were broken before):
- Native permission UI (attach with `tmux attach`; prompts are real & answerable).
- A REAL resumable session — `claude --resume <id>` finally works (it's an actual
  interactive session, not a `-p` invocation).
- Shows in your CLI/app session list.
- Carries join metadata (model/account/…) via our fork's MCP.

## Key files
- deploy/summoner/providers.mjs — `nativeLaunchSpec()` builds the harness launch;
  `agentRoomMcpServer()` points agents at OUR fork's local MCP build (not the
  stale npx package), against the local server (AGENT_ROOM_BASE_URL).
- deploy/summoner/service.mjs — doSummon writes a native launch.sh (harness +
  MCP config) instead of the driver loop; headless driver kept as fallback for
  providers not yet native (codex/copilot).
- deploy/summoner/workspaces.mjs — `isValidWorkspace()` accepts any real dir
  under home (kills the spurious "invalid workspace" on inherited paths).

## Verified
- claude boots in tmux, loads our fork MCP, JOINS a word-code room (cafe-ham-clog)
  at t+5s. (Reply/loop responsiveness: see test log.)

## THE join bug this uncovered (important)
Published upstream `agent-room-mcp` client-side rejects the server's WORD codes
(cafe-ham-clog) as "malformed" (it expects dashed ABC-DEF-GHJ, and uppercases).
The SERVER accepts word codes fine. So EVERY manual join via the published MCP
into a new room fails — headless summon only worked because it bypasses the MCP
(direct HTTP). Fixed in our fork's src (verbatim codes); reaches manual joins
only after the MCP reconciliation + publish.

## Still on native's default permission mode
Chat agents launched with `mcp__agent-room` allowed; sessions currently show
"bypass permissions on" (inherited). Hardening TODO: `--disallowedTools` for
chat so a chat agent can't touch files; explicit supervised/autonomous choice
for build mode.

## Not done (needs you)
- Codex / Gemini native launch (claude proven first; others fall back to headless).
- MCP fork reconciliation + publish (adopt upstream task-board + attachments,
  keep our questions, ship the code-format + join-metadata fixes). PUBLISH GATED
  ON YOUR REVIEW — see NIGHT-STATUS.md.

## RESPONSIVENESS — the open item (test, before trusting native for chat)
In the overnight test the agent JOINED (t+5s) and stayed in a live loop, but did
NOT reply to a probe within ~2min before I dismissed it. Root cause looks like
listen-window timing, not native launch:
- room_join runs its first listen window INLINE (listenAfterJoin=true) and blocked
  ~2m11s — i.e. the listen window is ~2min and did NOT return early when a new
  message arrived.
- If the server's `listen` long-poll doesn't wake promptly on new messages, EVERY
  reply is delayed up to a full window. That would also explain manual-join lag —
  and is squarely the "reliable join" north-star item.
ACTION for next session: (a) confirm whether server listen wakes on new-message,
(b) tune summoned agents to shorter listen windows / listenAfterJoin behavior,
(c) re-run the reply probe. Until then, native summon JOINS reliably; reply
latency is unverified.
