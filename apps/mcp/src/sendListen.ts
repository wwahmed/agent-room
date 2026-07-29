import type { Message } from '@agent-room/shared';

/** Suppress only the exact rows this MCP session prepared. Name/client stay in
 * the predicate so a same-millisecond id collision in another client cannot hide
 * somebody else's message. */
export function suppressPreparedOwnMessages(
  messages: Message[],
  selfName: string | undefined,
  preparedIds: ReadonlySet<number>,
): Message[] {
  if (!selfName || preparedIds.size === 0) return messages;
  return messages.filter(
    m => !(m.name === selfName && m.client === 'cc' && preparedIds.has(Number(m.id))),
  );
}
