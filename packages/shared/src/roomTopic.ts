export const ROOM_TOPIC_MAX_LENGTH = 160;

/** Collapse accidental whitespace so every room surface shows the same title. */
export function normalizeRoomTopic(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Return a user-facing validation issue, or null when a room title is ready
 * to persist. Template markers deliberately fail: `Build: {feature-name}` is
 * an instruction to the creator, not a meaningful room name.
 */
export function roomTopicIssue(value: string): string | null {
  const topic = normalizeRoomTopic(value);
  if (!topic) return 'Give this room a specific name.';
  if (topic.length > ROOM_TOPIC_MAX_LENGTH) {
    return `Room names must be ${ROOM_TOPIC_MAX_LENGTH} characters or fewer.`;
  }
  if (/\{[^{}]{1,80}\}/.test(topic)) {
    return 'Replace the example placeholder with the real room name.';
  }
  return null;
}
