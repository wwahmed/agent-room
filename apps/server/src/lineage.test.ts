import { readFileSync } from 'node:fs';
import type { Participant } from '@agent-room/shared';
import { describe, expect, it } from 'vitest';

import { LINEAGE_HEX_LENGTH, isWellFormedLineage, rowLineage } from './lineage.js';

const rooms = readFileSync(new URL('../../../packages/upstash-client/src/rooms.ts', import.meta.url), 'utf8');
const row = (over: Partial<Participant> = {}): Participant => ({
  name: 'MailAgent', role: '', color: '#000', initials: 'MA', client: 'cc',
  joinedAt: 1_000, lastSeenAt: 2_000, ...over,
});

// T-49: view actions cannot bind to a display name — names are mutable, they
// duplicate, and a rejoined agent wears the same one. My first attempt DERIVED a
// lineage from sha256(room:anchor:joinedAt); a verifier rejected it on two counts,
// both correct: it coupled a public id to secret material for nothing, and keying on
// joinedAt made an ordinary reconnect retire every card the session had posted.
describe('Session lineage', () => {
  it('is read from the row, never computed from credential material', () => {
    expect(rowLineage(row({ lineageId: 'a'.repeat(32) }))).toBe('a'.repeat(32));
    // A row that predates lineage stays UNBOUND rather than falling back to
    // anything forgeable like name+client.
    expect(rowLineage(row())).toBeNull();
    // The public id must not be a function of the anchors, so having anchors is
    // not enough to produce one.
    expect(rowLineage(row({ agentIdHash: 'anchor', authIdHash: 'auth', memberKeyHash: 'mk' }))).toBeNull();
  });

  it('refuses a malformed or client-invented value', () => {
    expect(isWellFormedLineage('a'.repeat(32))).toBe(true);
    for (const bad of ['', 'short', 'A'.repeat(32), 'z'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), 42, null, undefined]) {
      expect(isWellFormedLineage(bad), String(bad)).toBe(false);
    }
    expect(rowLineage(row({ lineageId: 'not-hex' }))).toBeNull();
  });

  it('is minted randomly at join and PRESERVED by a reclaiming join', () => {
    // Continuity follows the session credential: a reconnect proving the same
    // anchor/member key keeps its lineage, so its old cards revive. A genuinely new
    // identity mints a fresh one, so a replacement cannot inherit them by taking the
    // same display name.
    expect(rooms).toContain('reclaim?.lineageId ?? newLineageId()');
    expect(rooms).toContain('crypto.getRandomValues(bytes)');
    // 16 bytes -> 32 hex chars, matching the well-formedness guard.
    expect(rooms).toContain('new Uint8Array(16)');
    expect(LINEAGE_HEX_LENGTH).toBe(32);
  });

  it('TOMBSTONES a removed row so leaving is not permanent retirement', () => {
    // The gate: "host removal/leave may tombstone the lineage; explicit reactivation
    // of the same session can restore it." Without this, a kick or a clean leave
    // silently kills every card that session posted — and restoring on NAME would be
    // the hijack the whole design exists to stop. So the tombstone is keyed by the
    // anchor hash that proves ownership: presenting the credential is what revives it.
    expect(rooms).toContain('const lineageTombKey = (code: string, anchorHash: string)');
    expect(rooms).toContain('lineageTombKey(code, anchor), leaving.lineageId');
    expect(rooms).toContain("const found = await client.command<string | null>(['GET', lineageTombKey(code, anchor)]);");
    // A credential-proved tombstone outranks the reclaimed row's own lineage: a
    // reclaim can match a row this session never posted from.
    expect(rooms).toContain('lineageId: restoredLineage ?? reclaim?.lineageId ?? newLineageId()');
    // Kept OUT of the room record, so an anchor hash never rides along in a payload
    // — T-66 exists because hashes were being handed out.
    expect(rooms).toContain('lineagetomb:');
    expect(rooms).not.toMatch(/lineageTombstones/);
  });
});
