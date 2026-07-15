import { describe, it, expect } from 'vitest';
import { redactRoomPayload } from './redact.js';

// T-66. Rooms are visible to every member, so anything secret-derived on a room
// or a participant row is public to the room. The regression that matters most
// is authIdHash: it is sha256(<email>), and emails are low-entropy enough to
// confirm by dictionary — leaking it deanonymizes a real person.
describe('T-66 redactRoomPayload — no secret-derived field leaves the server', () => {
  const room = () => ({
    code: 'ABC-DEF-GHJ',
    topic: 't',
    hostKeyHash: 'h'.repeat(64),
    hostAuthIdHash: 'i'.repeat(64),
    participants: [
      { name: 'Waqas', client: 'web', memberKeyHash: 'm'.repeat(64), authIdHash: 'a'.repeat(64) },
      { name: 'Agent', client: 'cc', memberKeyHash: 'k'.repeat(64) },
    ],
  });

  it('strips authIdHash from every participant (email deanonymization)', () => {
    const out = redactRoomPayload({ room: room() });
    expect(out.room.participants.some((p: Record<string, unknown>) => 'authIdHash' in p)).toBe(false);
  });

  it('strips memberKeyHash, hostKeyHash, and hostAuthIdHash (auth verifiers)', () => {
    const out = redactRoomPayload({ room: room() });
    expect('hostKeyHash' in out.room).toBe(false);
    expect('hostAuthIdHash' in out.room).toBe(false);
    expect(out.room.participants.some((p: Record<string, unknown>) => 'memberKeyHash' in p)).toBe(false);
  });

  it('redacts the standalone participant the join path returns', () => {
    const out = redactRoomPayload({
      room: room(),
      participant: { name: 'Agent', memberKeyHash: 'k'.repeat(64), authIdHash: 'a'.repeat(64) },
    });
    expect('memberKeyHash' in out.participant).toBe(false);
    expect('authIdHash' in out.participant).toBe(false);
  });

  it('PASSES THROUGH the plaintext memberKey/hostKey — issued to their owner once', () => {
    const out = redactRoomPayload({ room: room(), memberKey: 'plain-member', hostKey: 'plain-host' });
    expect(out.memberKey).toBe('plain-member');
    expect(out.hostKey).toBe('plain-host');
  });

  it('keeps the room-visible fields the UI actually needs', () => {
    const out = redactRoomPayload({ room: room() });
    expect(out.room.code).toBe('ABC-DEF-GHJ');
    expect(out.room.participants.map((p: { name: string }) => p.name)).toEqual(['Waqas', 'Agent']);
  });

  it('does not mutate the caller’s object (the stored room must keep its hashes)', () => {
    const original = room();
    redactRoomPayload({ room: original });
    expect(original.hostKeyHash).toBeDefined();
    expect(original.hostAuthIdHash).toBeDefined();
    expect(original.participants[0].authIdHash).toBeDefined();
  });

  it('tolerates payloads with no room (messages, tasks, …)', () => {
    expect(redactRoomPayload({ messages: [1, 2] })).toEqual({ messages: [1, 2] });
    expect(redactRoomPayload(undefined)).toBeUndefined();
  });
});
