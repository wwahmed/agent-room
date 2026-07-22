import { describe, expect, it } from 'vitest';
import type { Message } from '@agent-room/shared';
import { stampMessageEnvelope } from './envelope.js';

// T-113: the exact corruption found in leap-lip-mule — 95 stored messages
// with only name/role/client/text/metadata — must be impossible to store
// again: the server stamps id and time and normalizes type to 'msg'.
describe('server-authoritative message envelope (T-113)', () => {
  const NOW = 1_784_726_000_000;

  it('stamps id, time, and type onto the leap-lip-mule corruption shape', () => {
    const raw = { name: 'Claude', role: 'implementer', client: 'cc', text: 'report', metadata: {} } as unknown as Message;
    const stamped = stampMessageEnvelope(raw, NOW);
    expect(stamped.id).toBe(NOW);
    expect(stamped.time).toBe(NOW);
    expect(stamped.type).toBe('msg');
    expect(stamped.text).toBe('report');
  });

  it('passes a well-formed envelope through untouched', () => {
    const m = { id: 123456, type: 'msg', name: 'A', client: 'cc', time: 123456, text: 'x' } as Message;
    const stamped = stampMessageEnvelope(m, NOW);
    expect(stamped.id).toBe(123456);
    expect(stamped.time).toBe(123456);
    expect(stamped.type).toBe('msg');
  });

  it('replaces malformed id/time values and never trusts a client-claimed sys type', () => {
    const m = { id: 'abc', type: 'sys', name: 'A', client: 'cc', time: -5, text: 'x' } as unknown as Message;
    const stamped = stampMessageEnvelope(m, NOW);
    expect(stamped.time).toBe(NOW);
    expect(stamped.id).toBe(NOW);
    expect(stamped.type).toBe('msg');
  });

  it('keeps a valid client time while stamping a missing id from that time', () => {
    const m = { type: 'msg', name: 'A', client: 'cc', time: 555, text: 'x' } as unknown as Message;
    const stamped = stampMessageEnvelope(m, NOW);
    expect(stamped.time).toBe(555);
    expect(stamped.id).toBe(555);
  });
});
