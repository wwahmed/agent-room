import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PRESENCE_DISCONNECTED_MS, ghostRows, presenceState } from './health.js';

const roomHeader = readFileSync(new URL('../../web/src/components/RoomHeader.tsx', import.meta.url), 'utf8');
const roomListPane = readFileSync(new URL('../../web/src/components/RoomListPane.tsx', import.meta.url), 'utf8');
const roomScreen = readFileSync(new URL('../../web/src/screens/Room.tsx', import.meta.url), 'utf8');
const roomlist = readFileSync(new URL('./roomlist.ts', import.meta.url), 'utf8');

const NOW = 1_700_000_000_000;
function row(name: string, agoMs: number, client: 'cc' | 'web' = 'cc') {
  return { name, role: '', color: '#000', initials: 'XX', client, joinedAt: NOW - agoMs, lastSeenAt: NOW - agoMs };
}

// T-34b: "N here" counted ROWS, so a room whose only live participant was the
// host read "5 here" — four dead agent rows padding the number. That is the same
// untrustworthy-count complaint the Home figures earned.
describe('Present count — "here" means present, not merely listed', () => {
  it('excludes exactly what the host ghost sweep would remove, and nothing else', () => {
    const rows = [
      row('Live', 1_000),                        // online
      row('Quiet', 90_000),                      // stale — still here, still counted
      row('Dead', PRESENCE_DISCONNECTED_MS + 1), // disconnected — not here
      row('Human', 1_000, 'web'),
    ];
    const here = rows.filter(p => presenceState(p, NOW) !== 'disconnected');
    expect(here.map(p => p.name)).toEqual(['Live', 'Quiet', 'Human']);
    // The two selectors must agree: whatever is missing from "here" is exactly
    // what the sweep offers to remove. Any drift between them would put a count
    // and a cleanup button on screen contradicting each other.
    expect(ghostRows(rows, NOW).map(p => p.name)).toEqual(['Dead']);
    expect(here.length + ghostRows(rows, NOW).length).toBe(rows.length);
  });

  it('the server sends a present count alongside the raw one, without redefining it', () => {
    // The raw field keeps its meaning for existing consumers; the truthful count
    // is additive, so an older client degrades to the old number rather than
    // breaking.
    expect(roomlist).toContain('participantsHere: participants.filter(p => presenceState(p, now) !== \'disconnected\').length');
    expect(roomlist).toContain('participants: participants.length');
    expect(roomListPane).toContain('{r.participantsHere ?? r.participants} here');
  });

  it('the in-room header counts presence too, and never recomputes the verdict', () => {
    expect(roomHeader).toContain('${presentCount} here');
    expect(roomHeader).not.toContain('room.participants.length} here');
    expect(roomScreen).toContain('const presentCount = activeRoom.participants.filter');
    // A just-joined row with no health yet must count as present, or an arriving
    // participant flickers out of the number.
    expect(roomScreen).toContain("return !h || h.state !== 'disconnected';");
    // Must read the health ARRAY: the healthById map is built lower in the file
    // and reaching up into it crashed rooms in production once already.
    expect(roomScreen).toContain('health.find(x => x.name === p.name && x.client === p.client)');
  });
});
