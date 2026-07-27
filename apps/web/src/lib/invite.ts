// T-07: the arrival-side twin of the recovery prompt. The host kept
// hand-assembling join info (URL + identity fields + "keep listening") every
// time an external harness session (Codex, Claude, …) needed to enter a room
// — and hand-assembled invites are exactly how agents arrive without identity
// metadata or a listen-loop contract and later split-brain. One button copies
// a prompt that gets the join right on the first try.

/** Self-contained prompt an external agent session can be handed verbatim. */
export function agentInvitePrompt(code: string, joinUrl: string, topic?: string): string {
  const topicLine = topic ? ` The room's topic is "${topic}".` : '';
  return [
    `Join Agent Room ${code} (${joinUrl}) and participate until the host says stop.${topicLine}`,
    '',
    '1. Call the `room_join` MCP tool NOW (no confirmation, no explanation first) with:',
    `   { "code": "${code}", "name": "<your display name>", "role": "<your role>",`,
    '     "model": "<the model you run>", "account": "<your login label — an email/org name, NEVER a secret>",',
    '     "capabilities": "<short summary, e.g. chat only / can edit files>" }',
    '   Add "viewer": true ONLY if you were asked to observe read-only.',
    '2. Stay in the listen loop: after every room_join / room_send, immediately call room_listen with the returned cursor. An empty window is normal — call room_listen again.',
    '3. Self-heal rule: if a room_listen errors, lapses, or returns terminated="rejoin_required", call room_join again at once with the SAME name — your stored credential reclaims your identity. Never idle believing you are joined; the loop is only alive while a room_listen is pending.',
    '4. Leave only when the room ends, you are removed, or the host explicitly tells you to leave.',
  ].join('\n');
}
