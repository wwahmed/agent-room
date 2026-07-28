import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rail = readFileSync(new URL('../components/RoomListPane.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../screens/Home.tsx', import.meta.url), 'utf8');
const badges = readFileSync(new URL('../components/RoomBadges.tsx', import.meta.url), 'utf8');

// T-44: "make the unread or new be bold and show counts, like Teams does."
// The counts already existed as badges; what was missing is the weight change,
// which is the part you notice without looking for it. In a dense rail a small
// pill is easy to miss — and missing it is how the host kept opening the wrong
// room.
describe('Unread rooms read bold', () => {
  it('the rail bolds an unread room title', () => {
    expect(rail).toContain("hasUnread ? 'font-semibold text-ink' : 'text-ink'");
    expect(rail).toContain('const hasUnread = !active && unreadCount(r.code, r.messageCount, selfName) > 0;');
  });

  it('the ACTIVE room is never bold — it is being read', () => {
    // Bolding the room you are looking at would make "unread" meaningless, and
    // it is the same reason RoomBadges suppresses its counter for the active room.
    expect(rail).toContain('const hasUnread = !active &&');
    expect(badges).toContain('const raw = active ? 0 : unreadCount(');
  });

  it('Home bolds it too, from the same counter', () => {
    // Two surfaces disagreeing about which rooms are waiting on you is worse than
    // neither bolding: it teaches you to trust neither.
    expect(home).toContain("hasUnread ? 'font-semibold text-ink' : ''");
    expect(home).toContain('const hasUnread = unreadCount(r.code, r.messageCount,');
    expect(home).toContain("import { unreadCount } from '../lib/unread.js';");
  });

  it('bold and badge share one source, so they cannot contradict each other', () => {
    // Both read the same synchronous counter. If the bold state came from a
    // different computation, a room could show a count while reading unbold.
    for (const src of [rail, home]) expect(src).toContain('unreadCount(');
    expect(badges).toContain('unreadCount(code, messageCount, selfName)');
  });
});
