import type { Message } from '@agent-room/shared';

// T-113: the server is the authority on the message envelope. A raw-send
// client in leap-lip-mule appended 95 messages with no id, no type, and no
// time — rows the reader keys, formats, and dispatches on. Client-supplied
// values are advisory: a well-formed envelope passes through untouched, and
// anything missing or malformed is stamped server-side so this corruption
// class is impossible regardless of which client misbehaves.
export function stampMessageEnvelope(message: Message, now: number = Date.now()): Message {
  const time = typeof message.time === 'number' && Number.isFinite(message.time) && message.time > 0
    ? message.time
    : now;
  const id = typeof message.id === 'number' && Number.isFinite(message.id) && message.id > 0
    ? message.id
    : time;
  // The send action carries participant speech; server code paths
  // (sysMessage/appendSystemMessage) are the only authors of 'sys' rows, so a
  // client-claimed type is normalized to 'msg' rather than trusted.
  return { ...message, id, time, type: 'msg' };
}
