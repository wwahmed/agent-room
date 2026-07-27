import type { Participant } from '@agent-room/shared';

// T-20: truthful delivery markers. An agent's listen-arm timestamp
// (Participant.listenArmedAt) is a delivery watermark: arming a listen drains
// the room up to that instant, so a message OLDER than the watermark has
// verifiably been handed to that agent's session. This is "delivered", never
// "read" — the model received the text; nobody claims it acted on it.
//
// Scope rules:
//   - cc rows only: web rows are humans/browsers with no listen loop.
//   - viewers excluded: a read-only observer's consumption is nobody's signal.
//   - strictly OLDER than the watermark: a message stamped in the same
//     millisecond as the arm may have missed the drain — undercount, never
//     overclaim.
export function deliveredAgents(
  participants: Array<Pick<Participant, 'name' | 'client' | 'viewer' | 'listenArmedAt'>> | undefined,
  messageTime: number,
): string[] {
  if (!participants || !Number.isFinite(messageTime)) return [];
  return participants
    .filter(p =>
      p.client === 'cc' &&
      p.viewer !== true &&
      Number(p.listenArmedAt || 0) > messageTime)
    .map(p => p.name);
}
