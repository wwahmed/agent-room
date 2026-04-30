import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message, Room } from '@agent-room/shared';
import { MAX_MESSAGES_PER_ROOM, ROOM_TTL_SECONDS } from '@agent-room/shared';
import { createClient, appendMessage, listMessages, NotApprovedError } from '../src/index.js';

const ENV = { url: 'https://example.upstash.io', token: 't' };
function mockResp(body: unknown) { return new Response(JSON.stringify(body)); }

const MSG: Message = {
  id: 1, type: 'msg', name: 'A', initials: 'AA', color: '#111',
  role: 'r', text: 'hi', client: 'web', time: 1,
};

const APPROVED_ROOM: Room = {
  code: 'ABC-DEF-GHJ', topic: 't', createdAt: 0, createdBy: 'host', status: 'active', version: 1,
  participants: [
    { name: 'A', role: 'r', color: '#111', initials: 'AA', client: 'web', joinedAt: 0, lastSeenAt: 0, canSpeak: true },
  ],
};

describe('appendMessage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('RPUSHes the message, LTRIMs to the cap, and refreshes TTL when sender is approved', async () => {
    const fetchMock = vi.fn()
      // First call: getRoom (speak gate check)
      .mockResolvedValueOnce(mockResp({ result: JSON.stringify(APPROVED_ROOM) }))
      // Second call: pipeline (RPUSH+LTRIM+EXPIRE)
      .mockResolvedValueOnce(mockResp([{ result: 1 }, { result: 'OK' }, { result: 1 }]));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient(ENV);
    await appendMessage(client, 'ABC-DEF-GHJ', MSG);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[1]!; // pipeline call
    const cmds = JSON.parse((init as any).body);
    expect(cmds).toHaveLength(3);
    expect(cmds[0][0]).toBe('RPUSH');
    expect(cmds[0][1]).toBe('room-msgs:ABC-DEF-GHJ');
    expect(JSON.parse(cmds[0][2])).toEqual(MSG);
    expect(cmds[1][0]).toBe('LTRIM');
    expect(cmds[1][2]).toBe(-MAX_MESSAGES_PER_ROOM);
    expect(cmds[1][3]).toBe(-1);
    expect(cmds[2][0]).toBe('EXPIRE');
    expect(cmds[2][1]).toBe('room-msgs:ABC-DEF-GHJ');
    expect(cmds[2][2]).toBe(ROOM_TTL_SECONDS);
  });

  it('throws NotApprovedError when the sender is pending host approval', async () => {
    const pendingRoom: Room = {
      ...APPROVED_ROOM,
      participants: [
        { ...APPROVED_ROOM.participants[0]!, canSpeak: false },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResp({ result: JSON.stringify(pendingRoom) })));
    const client = createClient(ENV);
    await expect(appendMessage(client, 'ABC-DEF-GHJ', MSG)).rejects.toBeInstanceOf(NotApprovedError);
  });

  it('throws NotApprovedError when the sender is not in the participants list', async () => {
    const emptyRoom: Room = { ...APPROVED_ROOM, participants: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResp({ result: JSON.stringify(emptyRoom) })));
    const client = createClient(ENV);
    await expect(appendMessage(client, 'ABC-DEF-GHJ', MSG)).rejects.toBeInstanceOf(NotApprovedError);
  });
});

describe('listMessages', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('LRANGEs from the given index and parses each entry', async () => {
    const msg1: Message = { id: 1, type: 'msg', name: 'A', initials: 'AA', color: '#111', role: '', text: 'hi', client: 'web', time: 1 };
    const msg2: Message = { ...msg1, id: 2, text: 'yo' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResp({ result: [JSON.stringify(msg1), JSON.stringify(msg2)] })));

    const client = createClient(ENV);
    const got = await listMessages(client, 'ABC-DEF-GHJ', 5);
    expect(got).toEqual([msg1, msg2]);
  });

  it('returns [] when list is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResp({ result: [] })));
    const client = createClient(ENV);
    expect(await listMessages(client, 'ABC-DEF-GHJ', 0)).toEqual([]);
  });

  it('passes the LRANGE command with correct key, fromIndex, and -1 endIndex', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResp({ result: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient(ENV);
    await listMessages(client, 'XYZ-123-ABC', 42);
    const [, init] = fetchMock.mock.calls[0]!;
    const cmd = JSON.parse((init as any).body);
    expect(cmd).toEqual(['LRANGE', 'room-msgs:XYZ-123-ABC', 42, -1]);
  });
});
