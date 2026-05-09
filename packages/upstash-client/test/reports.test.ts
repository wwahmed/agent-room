import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message, Room } from '@agent-room/shared';
import { createClient, createRoomReport, getRoomReport, REPORT_RETENTION } from '../src/index.js';

const ENV = { url: 'https://example.upstash.io', token: 't' };

function mockResp(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

function sampleRoom(): Room {
  return {
    code: 'ABC-DEF-GHJ',
    topic: 'Ship report assets',
    createdAt: 1,
    createdBy: 'Robin',
    status: 'ended',
    version: 2,
    participants: [
      { name: 'Robin', role: 'Facilitator', color: '#F59E0B', initials: 'RO', client: 'web', joinedAt: 1, lastSeenAt: 2, canSpeak: true },
      { name: 'Codex', role: 'Platform', color: '#5B6AFF', initials: 'CO', client: 'cc', joinedAt: 1, lastSeenAt: 2, canSpeak: true },
    ],
  };
}

function sampleMessages(): Message[] {
  return [
    {
      id: 10,
      type: 'msg',
      name: 'Codex',
      role: 'Platform',
      text: '[DECISION] Store exported reports as permanent share assets.',
      time: 3,
      client: 'cc',
    },
  ];
}

describe('reports', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('documents exported report retention as permanent', () => {
    expect(REPORT_RETENTION).toBe('permanent');
  });

  it('stores exported reports without any Redis TTL modifier', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResp({ result: 'OK' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient(ENV);
    const report = await createRoomReport(client, sampleRoom(), sampleMessages());

    expect(report.code).toBe('ABC-DEF-GHJ');
    const [, init] = fetchMock.mock.calls[0]!;
    const cmd = JSON.parse((init as RequestInit).body as string);
    expect(cmd[0]).toBe('SET');
    expect(cmd[1]).toBe('room-report:ABC-DEF-GHJ');
    expect(JSON.parse(cmd[2]).topic).toBe('Ship report assets');
    expect(cmd.slice(3)).toEqual([]);
    expect(cmd).not.toContain('EX');
    expect(cmd).not.toContain('PX');
    expect(cmd).not.toContain('EXAT');
    expect(cmd).not.toContain('PXAT');
    expect(cmd).not.toContain('KEEPTTL');
  });

  it('reads a previously exported report by code', async () => {
    const stored = {
      ...await createRoomReport(
        { command: vi.fn().mockResolvedValue('OK'), pipeline: vi.fn() },
        sampleRoom(),
        sampleMessages()
      ),
      exportedAt: 100,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResp({ result: JSON.stringify(stored) })));

    const client = createClient(ENV);
    await expect(getRoomReport(client, 'ABC-DEF-GHJ')).resolves.toMatchObject({
      code: 'ABC-DEF-GHJ',
      topic: 'Ship report assets',
      exportedAt: 100,
    });
  });
});
