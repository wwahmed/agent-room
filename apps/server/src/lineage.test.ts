import type { Participant } from '@agent-room/shared';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { LINEAGE_HEX_LENGTH, deriveLineage, isWellFormedLineage, lineageAnchor } from './lineage.js';

const sha = async (s: string) => createHash('sha256').update(s).digest('hex');
const row = (over: Partial<Participant> = {}): Participant => ({
  name: 'MailAgent', role: '', color: '#000', initials: 'MA', client: 'cc',
  joinedAt: 1_000, lastSeenAt: 2_000, ...over,
});

// T-49: a verifier refused to call view actions safe while they bound to a display
// name — names are mutable, they duplicate, and a rejoined session wears the same
// one. Lineage is the anchor that survives all three.
describe('Session lineage', () => {
  it('is stable across a display-name change', async () => {
    const before = await deriveLineage('a-b-c', row({ agentIdHash: 'anchor1' }), sha);
    const after = await deriveLineage('a-b-c', row({ agentIdHash: 'anchor1', name: 'Renamed' }), sha);
    expect(before).toBe(after);
    expect(before).toMatch(new RegExp(`^[0-9a-f]{${LINEAGE_HEX_LENGTH}}$`));
  });

  it('distinguishes two participants sharing one display name', async () => {
    const a = await deriveLineage('a-b-c', row({ agentIdHash: 'anchorA' }), sha);
    const b = await deriveLineage('a-b-c', row({ agentIdHash: 'anchorB' }), sha);
    expect(a).not.toBe(b);
  });

  it('distinguishes a rejoined session from the one it replaced', async () => {
    const first = await deriveLineage('a-b-c', row({ agentIdHash: 'anchor1', joinedAt: 1_000 }), sha);
    const rejoined = await deriveLineage('a-b-c', row({ agentIdHash: 'anchor1', joinedAt: 9_000 }), sha);
    expect(first).not.toBe(rejoined);
  });

  it('is room-scoped, so one room cannot speak for another', async () => {
    const here = await deriveLineage('a-b-c', row({ agentIdHash: 'anchor1' }), sha);
    const there = await deriveLineage('x-y-z', row({ agentIdHash: 'anchor1' }), sha);
    expect(here).not.toBe(there);
  });

  it('is NOT the credential anchor — publishing that per message would be the worse leak', async () => {
    const secret = 'anchor-that-must-not-travel';
    const lineage = await deriveLineage('a-b-c', row({ agentIdHash: secret }), sha);
    expect(lineage).not.toContain(secret);
    // One-way: the value is a truncated digest, not a reversible encoding.
    expect(lineage).not.toBe(secret);
    expect(lineage).toHaveLength(LINEAGE_HEX_LENGTH);
  });

  it('prefers the most durable anchor, and returns null when there is none', async () => {
    expect(lineageAnchor(row({ agentIdHash: 'a', authIdHash: 'b', memberKeyHash: 'c' }))).toBe('a');
    expect(lineageAnchor(row({ authIdHash: 'b', memberKeyHash: 'c' }))).toBe('b');
    expect(lineageAnchor(row({ memberKeyHash: 'c' }))).toBe('c');
    // A credential-unaware legacy row stays UNBOUND rather than falling back to
    // something forgeable like name+client.
    expect(lineageAnchor(row())).toBeNull();
    expect(await deriveLineage('a-b-c', row(), sha)).toBeNull();
  });

  it('rejects a malformed or invented lineage value', () => {
    expect(isWellFormedLineage('a'.repeat(32))).toBe(true);
    for (const bad of ['', 'short', 'A'.repeat(32), 'z'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), 42, null, undefined]) {
      expect(isWellFormedLineage(bad), String(bad)).toBe(false);
    }
  });
});
