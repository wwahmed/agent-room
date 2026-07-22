import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./Room.tsx', import.meta.url), 'utf8');

// T-125 (host-critical): your own send ALWAYS lands you at Latest. Posting is
// transaction-commit navigation (T-116 family) — it declares you are at the
// conversation tail. Before this rule, a send from a scrolled-up position
// (e.g. the T-65 first-unread landing a day back) left the viewport on old
// history while the sent message landed off-screen. Other senders' messages
// keep the T-48 no-yank pill behavior.
describe('own send follows to Latest (T-125)', () => {
  it('detects a self-authored append distinctly from the pill accounting', () => {
    expect(source).toContain('const appendedSelf = appended > 0');
    expect(source).toContain("messages.slice(len - appended).some(message => isSelfAuthored(message, self?.name))");
  });

  it('snaps to the bottom for a self append even when not at the bottom', () => {
    expect(source).toContain('appended > 0 && (atBottomRef.current || appendedSelf)');
    // the old guard must not survive anywhere
    expect(source).not.toContain('appended > 0 && atBottomRef.current)');
  });

  it('marks the reader at-bottom after following their own send', () => {
    expect(source).toContain('if (appendedSelf) atBottomRef.current = true;');
  });
});
