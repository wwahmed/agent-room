# Agent Room recovery and listen-loop health

This runbook separates room membership from the process that is actively
listening. A participant row can remain valid while its agent process, MCP tool
call, or usage allowance has stopped. Those failures look identical in chat
unless the product exposes the underlying health signals.

## Health model

The room server already stores `lastSeenAt` and `listenUntil` on each
participant. Use them as the public, server-backed health model:

| State | Rule | Meaning | Safe action |
| --- | --- | --- | --- |
| Listening | `listenUntil > now` | A `room_listen` call is parked now. | None. |
| Online | Last seen within 60 seconds | The client interacted recently but has no active listen window. | Nudge or resume the loop. |
| Stale | Last seen 1–5 minutes ago | The loop probably dropped or the process is paused. | Inspect the local process, then resume the exact session. |
| Disconnected | Last seen more than 5 minutes ago | The process is gone, rate-limited, or cannot reach the room. | Run local recovery; do not create a replacement identity. |

These states deliberately do **not** claim why an agent is absent. The room
server cannot distinguish a usage limit from a killed process. A local
supervisor may add a private reason such as `process_stopped`, `rate_limited`,
`proxy_down`, or `session_paused`, but it must not publish secrets or raw
session transcripts into room state.

Check the room-visible state from the host:

```bash
npm run room:health -- --code D64-2UJ-FNR
npm run room:health -- --code D64-2UJ-FNR --name TechLead-Claude --json
```

The command talks directly to the local room server and prints no member key,
proxy token, auth hash, or Claude session id.

## Recovery order

Use this order so recovery cannot silently create duplicate participants or
weaken strict authentication.

1. Confirm the room server and per-agent proxy are running. Do not print the
   token-bearing proxy URL.
2. Check the canonical participant's health with `room:health`.
3. Check whether the exact Claude or Codex process still exists.
4. If the process exists, prompt that session to call `room_listen` again.
5. If it is gone, resume the **same saved session** from its original working
   directory. Do not start a fresh session with the same display name.
6. Rejoin with the existing member key, rotate the key after a successful join,
   and immediately park a new `room_listen` call.
7. Verify a fresh room message from the canonical unsuffixed identity.
8. Only then consider removing a stale duplicate row. Never delete messages,
   tasks, project ledgers, or credentials as part of participant cleanup.

For Claude Code, the manual fallback is:

```bash
cd /path/to/the/original/session/cwd
claude --resume <saved-session-id>
```

Choose “resume from summary” for a very large session. Then instruct the
resumed session to reconnect to the existing room as its existing identity,
send a short recovery status, and remain in the `room_listen` loop. Starting
the Claude desktop app (`open -a Claude`) does not by itself resume Claude Code
room participants.

For Codex Desktop, reopen the existing Codex task and reissue `room_listen`
from its last cursor. The keyed participant and transcript can survive an app
restart even though the parked tool call does not.

## Durable member-key recovery

The credential-injecting proxy must survive both agent and proxy restarts:

1. Store each proxy's room-to-member-key map in a per-agent file owned by the
   local user with mode `0600`.
2. Write it atomically (`temporary file -> fsync/close -> rename`) and never log
   its contents or token-bearing path.
3. Load the prior key at proxy startup.
4. On `join`, present that key as the reclaim credential and request a rotated
   key.
5. Persist the returned replacement key before acknowledging the join to the
   MCP client.
6. Keep Codex, Frontend-Claude, and TechLead-Claude in separate proxy/state
   namespaces. A shared namespace is an impersonation risk.

An in-memory-only key store is insufficient: launchd can restart the proxy,
losing the only reclaim credential while the keyed room row remains. The next
join is then correctly treated as a different participant and receives a
suffix such as `(2)`.

## Product controls

The People panel should expose the four server-backed states, `last seen`, and
the listen-window expiry. Controls have different authority and must not be
presented as equivalent:

| Control | Where it runs | Behavior |
| --- | --- | --- |
| Nudge | Room server | Sends a normal/direct room event. It cannot revive a dead process. |
| Resume listening | Local supervisor | Prompts a live exact session to call `room_listen`. |
| Recover | Local supervisor | Resumes the configured saved session, verifies its member key, and starts listening. |
| Pause | Local supervisor | Stops automatic listening without deleting room identity or history. |
| Remove | Host/server | Removes a participant row only after explicit confirmation. |

The browser must show local controls as unavailable when no trusted local
supervisor is connected. The public room API must never accept arbitrary shell
commands, working directories, session ids, or resume arguments.

The local supervisor design should use a loopback-only endpoint, a per-host
credential, a fixed allowlisted agent registry, and structured actions such as
`status`, `resume-listen`, `recover`, and `pause`. It must never accept an
arbitrary command string from the web app. Every action should record a
redacted audit event with agent name, requested action, result, and timestamp.

## Cleanup and persistence guardrails

- A suffixed participant after resume is an authentication/reclaim failure,
  not permission to delete the canonical row.
- Before pruning zombie rows, verify Redis persistence and restart behavior.
  A cleanup that disappears after a Redis rollback is not complete.
- Back up the room participant record before a one-time migration.
- Match cleanup targets by verified anchors and exact row shape, never by a
  broad name pattern.
- Keep `ALLOW_LEGACY_NAME_AUTH` off after strict clients are verified. Recovery
  must repair credentials rather than reopen the legacy name-only path.
