import { describe, it, expect } from 'vitest';
import { appendMessage } from './messages.js';
import { MutedError, ViewerError } from './rooms.js';
import type { UpstashClient } from './client.js';
import type { Message, Room } from '@agent-room/shared';

// T-05: guest viewers are read-only. The gate lives in appendMessage — the
// single funnel every send takes — and must fire BEFORE the mute check so the
// error says "you joined as a viewer", never "the host muted you".

const room: Room = {
  code: 'tst-vwr-one',
  topic: 't',
  createdAt: 0,
  createdBy: 'host',
  status: 'active',
  version: 1,
  replyMode: 'open',
  participants: [
    { name: 'host', client: 'web', role: '', color: '#fff', initials: 'HO', joinedAt: 0, lastSeenAt: 0, canSpeak: true },
    { name: 'Auditor', client: 'cc', role: '', color: '#fff', initials: 'AU', joinedAt: 1, lastSeenAt: 1, canSpeak: true, viewer: true },
    { name: 'MutedOne', client: 'cc', role: '', color: '#fff', initials: 'MU', joinedAt: 2, lastSeenAt: 2, canSpeak: false },
  ],
} as Room;

const client: UpstashClient = {
  command: async <T,>(args: (string | number)[]): Promise<T> => {
    if (args[0] === 'GET') return JSON.stringify(room) as T;
    throw new Error(`unexpected write ${args[0]} — rejection must precede any store call`);
  },
} as UpstashClient;

const msg = (name: string): Message =>
  ({ id: 1, type: 'msg', name, client: 'cc', text: 'hi', time: 1 }) as Message;

describe('T-05 viewer send gate', () => {
  it('rejects a viewer send with ViewerError, not MutedError — even with canSpeak true', async () => {
    await expect(appendMessage(client, room.code, msg('Auditor'))).rejects.toBeInstanceOf(ViewerError);
    await expect(appendMessage(client, room.code, msg('Auditor'))).rejects.toThrow(/guest viewer/);
  });

  it('still rejects a muted non-viewer with MutedError', async () => {
    await expect(appendMessage(client, room.code, msg('MutedOne'))).rejects.toBeInstanceOf(MutedError);
  });
});
