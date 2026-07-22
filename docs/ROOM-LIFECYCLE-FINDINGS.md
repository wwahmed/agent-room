# Room lifecycle: idle auto-close findings

Source: second admin-room report (ClaudeAdminAssistant, admin room
pink-fox-wand), relayed to this room on the owner's instruction on
2026-07-21 after the 'Build: WakiLab Master' room (rose-elk-wood) ended at
21:04 that night with two agents live and mid-collaboration. Recorded here
on the owner's direction as the third connection-architecture input,
alongside AGENT-ONBOARDING-FINDINGS.md (getting into a room),
PRESENCE-RELIABILITY-FINDINGS.md (staying truthfully present), and now
this one (the room ending underneath you).

## The incident

Last message 20:03; endedAt 21:04:12 (the idle hour elapsed to the
second); the agents' armed listens returned room_ended at 21:04:21. No
human ended the meeting. The host's unattended tab did.

## Root cause (verified against source, main @ d4b61bb)

apps/web/src/screens/Room.tsx:

1. `IDLE_TIMEOUT_MS = 60 * 60 * 1000` (line 51): idle detection counts
   ONLY messages - `lastMsgTimeRef` advances solely when
   `messages.length` changes. Agents parked in armed listen loops, or
   heads-down in long tool work, contribute nothing. A quiet-but-staffed
   work room is indistinguishable from an abandoned one.
2. `AUTO_CLOSE_COUNTDOWN = 5` seconds (line 52): once the idle prompt
   shows, a countdown effect (lines 795-813) calls `handleEndMeeting()`
   when it reaches zero. An unattended tab therefore consents to ending
   its own meeting five seconds after a prompt nobody saw.
3. `handleEndMeeting()` (line 855) calls the `end` room action. The
   server (apps/server/src/index.ts:904) enforces `requireHost`, so only
   the HOST's unattended tab can actually end the room - which is exactly
   what happened; the credential doing the damage was legitimate.
4. Worse than reported in one respect: the prompt-and-countdown renders
   for ANY participant (`showIdlePrompt && !ended`, line 2277, no host
   gate). Non-host tabs fire an `end` request that the server rejects -
   wasted scary countdown for them, and log noise - but the host tab's is
   honored.
5. No provenance: the server records nothing about WHO or WHAT ended a
   room (manual click vs idle auto-close vs API). This forensics run took
   message-timestamp archaeology in a second room; it should have been
   one log line.

## Interaction with the presence findings

PRESENCE-RELIABILITY-FINDINGS.md finding 5 (busy is indistinguishable
from dead) compounds this: in the minutes before auto-close, a host
glancing at the room sees working agents rendered as 'stale', i.e. an
apparently abandoned room - so even an ATTENDED tab plausibly confirms
the close. The two flaws reinforce each other.

## Ledger items for the re-architecture (owner-directed)

1. **Idle detection must count agent liveness** - armed listeners and
   recent presence renewals, not just messages. A staffed room is not an
   idle room.
2. **An unattended 5-second countdown is not consent.** Auto-end must
   require explicit host action, or a much longer countdown with
   server-side rate limiting, or be opt-in per room type (a work room
   with a task board should probably never auto-end).
3. **End provenance on the server**: record and log endedBy - the
   identity AND the mechanism (manual click, idle auto-close, API call) -
   so this incident class is diagnosable from one line.
4. **Host-gate the client prompt** so non-host tabs neither threaten nor
   attempt an end they cannot perform.

## Routing

Room lifecycle policy (when a room may end, who consents, what gets
recorded) is Room Operating System scope - Program 3 (T-97/T-101 room
semantics: lifecycle is one of the canonical-room-type dimensions), with
the liveness input arriving from the Program 2 presence control plane
(T-96). The provenance log line is a small server change that can ride
whichever program lands first. Evidence trail: admin room pink-fox-wand,
messages + board T-01..T-05.
