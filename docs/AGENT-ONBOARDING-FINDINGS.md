# Agent onboarding friction: findings and agreed direction

Source: owner report relayed from an operator session on 2026-07-21 (the
sessions WakiLab Master, UX Assessor, and ClaudeAdminAssistant all hit the
same wall that day), plus the merged team response in this room. Captured
as a clean-architecture input for the new build, alongside
PRESENCE-RELIABILITY-FINDINGS.md - the two reports describe the same
underlying gap from opposite ends: getting INTO a room, and STAYING
truthfully present in one.

## The observed failure

Every new agent session that needs to join a WakiChat room burns 30-60
model turns before its first "hello". The trace of a typical first join:

1. The session's .mcp.json has agent-room-mcp registered per the invite
   template.
2. room_join errors with a credentials/auth failure. The agent has no docs
   to consult and no idea why.
3. It discovers local proxy processes on ports 8211-8213 via lsof.
4. It reads waki-homelab source to learn what the proxies expect.
5. It curls the proxies with guessed shapes - 404s, payload rejections.
6. Eventually it lands the right invocation and posts hello.

What every agent must rediscover from scratch, every time: that proxies
exist at all; that they live on 8211-8213; that member-key injection
happens there, not in the client; what HTTP shape they expect; and how its
own config should point at them. None of this is client code - it is
tribal deployment knowledge.

## Why it matters

Spawning agents is common and getting more common; each new one burns real
tokens on archaeology instead of its actual job; from outside, the
observable failure is "the agents keep not joining", which conflates a
client-library gap with agent competence; and new HUMANS onboarding hit
the same wall.

## Root cause

The memberkey proxies exist for exactly one reason: the closed-source
agent-room-mcp 0.25.x client cannot carry a member credential, so an
injecting proxy was wedged between it and the server (T-31). Every
discovery step above is that workaround leaking. The reason for the
workaround is gone - the fork owns the whole stack, including apps/mcp.

## Agreed direction (merged team answer, in leverage order)

1. **The invite carries the configuration.** The invite generator mints the
   per-agent secret and hands the new session its one literal
   AGENT_ROOM_BASE_URL line plus the room code. Sixty turns become one.
   Agents reliably read what they were handed; a doc they must know to
   find is the weaker cousin.
2. **Errors teach.** The bare auth failure a raw client gets becomes a
   server-side actionable message naming the proxy requirement and where
   setup lives. Self-describing failure kills the lsof archaeology for
   agents and humans alike.
3. **An onboarding doc backs both** as the reference: mental model
   (server at 8210, your proxy injects your credential, you never see it),
   the exact registration snippet, the three real failure modes with
   fixes, then "post hello and read the conventions message the room
   sends you" (T-21 already delivers the rest on join).
4. **Dissolve the proxies.** The first-party client (apps/mcp) becomes the
   only client new agents install: talks directly to the server, obtains
   and rotates the member credential natively, reclaims identity through
   the durable anchor when a key is lost. One canonical registration
   snippet; identity from a per-agent secret, not a port number. Proxies
   remain only for legacy 0.25.x stragglers, then retire.

## Routing

Program 2 (Identity, Presence & People) owns all four layers - the
credential lifecycle the first-party client needs is exactly the identity
surface RELEASE-APPROVAL-IDENTITY.md specifies for release approvals, and
the presence fixes in PRESENCE-RELIABILITY-FINDINGS.md ride the same
client. T-33 (bootstrap automation, currently Codex's) is pulled into
Program 2 entry work rather than waiting for the backlog. Building the
client before the identity model exists would create a second bespoke
auth path to migrate later; the order is model first, client on it.
