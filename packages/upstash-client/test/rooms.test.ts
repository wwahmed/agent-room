import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Room } from '@agent-room/shared';
import { createClient, createRoom, getRoom, RoomNotFoundError, casRoom, ConcurrencyError, joinRoom } from '../src/index.js';

const ENV = { url: 'https://example.upstash.io', token: 't' };

function mockResp(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

describe('createRoom', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('stores a room JSON under the given code with 24h TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResp({ result: 'OK' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient(ENV);
    const room = await createRoom(client, {
      code: 'ABC-DEF-GHJ',
      topic: 'Q3',
      createdBy: 'Alex',
    });

    expect(room.code).toBe('ABC-DEF-GHJ');
    expect(room.version).toBe(1);
    expect(room.participants).toEqual([]);

    const [, init] = fetchMock.mock.calls[0]!;
    const cmd = JSON.parse((init as any).body);
    expect(cmd[0]).toBe('SET');
    expect(cmd[1]).toBe('room:ABC-DEF-GHJ');
    const stored = JSON.parse(cmd[2]);
    expect(stored.topic).toBe('Q3');
    expect(cmd).toContain('EX');
    expect(cmd).toContain(86400);
  });
});

describe('getRoom', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns parsed Room when present', async () => {
    const room: Room = {
      code: 'ABC-DEF-GHJ',
      topic: 'Q3',
      createdAt: 1,
      createdBy: 'Alex',
      status: 'active',
      version: 2,
      participants: [],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResp({ result: JSON.stringify(room) })));
    const client = createClient(ENV);
    const fetched = await getRoom(client, 'ABC-DEF-GHJ');
    expect(fetched).toEqual(room);
  });

  it('throws RoomNotFoundError when key is missing (result is null)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResp({ result: null })));
    const client = createClient(ENV);
    await expect(getRoom(client, 'MIS-SIN-GXY')).rejects.toBeInstanceOf(RoomNotFoundError);
  });
});

describe('casRoom', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('writes when the current version matches', async () => {
    const base: Room = { code: 'A', topic: 't', createdAt: 0, createdBy: 'x', status: 'active', version: 3, participants: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResp({ result: JSON.stringify(base) }))             // GET
      .mockResolvedValueOnce(mockResp({ result: 'OK' }));                            // SET

    vi.stubGlobal('fetch', fetchMock);
    const client = createClient(ENV);
    const updated = await casRoom(client, 'A', current => ({ ...current, topic: 'changed' }));

    expect(updated.topic).toBe('changed');
    expect(updated.version).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries when mutator throws ConcurrencyError and succeeds on a later attempt', async () => {
    const v3: Room = { code: 'A', topic: 't', createdAt: 0, createdBy: 'x', status: 'active', version: 3, participants: [] };
    const v4: Room = { ...v3, version: 4 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResp({ result: JSON.stringify(v3) }))    // GET #1
      .mockResolvedValueOnce(mockResp({ result: JSON.stringify(v4) }))    // GET #2
      .mockResolvedValueOnce(mockResp({ result: 'OK' }));                 // SET
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient(ENV);

    let attempts = 0;
    const updated = await casRoom(client, 'A', current => {
      attempts++;
      if (attempts === 1) throw new ConcurrencyError();
      return { ...current, topic: `attempt${attempts}` };
    });
    expect(updated.topic).toBe('attempt2');
    expect(updated.version).toBeGreaterThanOrEqual(4);
    expect(attempts).toBe(2);
  });

  it('throws ConcurrencyError after 3 failed attempts', async () => {
    const v3: Room = { code: 'A', topic: 't', createdAt: 0, createdBy: 'x', status: 'active', version: 3, participants: [] };
    const fetchMock = vi.fn().mockResolvedValue(mockResp({ result: JSON.stringify(v3) }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient(ENV);

    let calls = 0;
    await expect(casRoom(client, 'A', () => {
      calls++;
      throw new ConcurrencyError();
    })).rejects.toBeInstanceOf(ConcurrencyError);
    expect(calls).toBe(3);
  });
});

describe('joinRoom', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('appends a participant and bumps version', async () => {
    const before: Room = { code: 'A', topic: 't', createdAt: 0, createdBy: 'x', status: 'active', version: 1, participants: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResp({ result: JSON.stringify(before) }))
      .mockResolvedValueOnce(mockResp({ result: 'OK' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient(ENV);
    const updated = await joinRoom(client, 'A', {
      name: 'Sarah', role: 'PM', color: '#EC4899', initials: 'SK', client: 'web',
      joinedAt: 100, lastSeenAt: 100,
    });

    expect(updated.participants).toHaveLength(1);
    expect(updated.participants[0]!.name).toBe('Sarah');
    expect(updated.participant.name).toBe('Sarah');
    // Mute model: everyone defaults to canSpeak=true on join. Host can
    // mute via setMuted() to flip a specific participant to false.
    expect(updated.participants[0]!.canSpeak).toBe(true);
    expect(updated.version).toBe(2);
  });

  it('auto-suffixes a colliding name on the same client kind', async () => {
    const before: Room = {
      code: 'A', topic: 't', createdAt: 0, createdBy: 'host', status: 'active', version: 1,
      participants: [
        { name: 'Robin', role: '', color: '#000', initials: 'RO', client: 'web', joinedAt: 0, lastSeenAt: 0, canSpeak: true },
      ],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResp({ result: JSON.stringify(before) }))
      .mockResolvedValueOnce(mockResp({ result: 'OK' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient(ENV);
    const updated = await joinRoom(client, 'A', {
      name: 'Robin', role: '', color: '#000', initials: 'RO', client: 'web',
      joinedAt: 100, lastSeenAt: 100,
    });

    expect(updated.participant.name).toBe('Robin (2)');
    expect(updated.participants).toHaveLength(2);
  });

  it('lands cc (agent) joiners with canSpeak=true (mute model)', async () => {
    const before: Room = { code: 'A', topic: 't', createdAt: 0, createdBy: 'host', status: 'active', version: 1, participants: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResp({ result: JSON.stringify(before) }))
      .mockResolvedValueOnce(mockResp({ result: 'OK' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient(ENV);
    const updated = await joinRoom(client, 'A', {
      name: 'Codex', role: 'AI', color: '#000', initials: 'CO', client: 'cc',
      joinedAt: 100, lastSeenAt: 100,
    });

    // Mute model: everyone (web + cc) defaults to true. Host mutes
    // specific participants via setMuted() if they need to be silenced.
    expect(updated.participant.canSpeak).toBe(true);
  });
});
