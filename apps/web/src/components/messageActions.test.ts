import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const menu = readFileSync(new URL('./MessageMenu.tsx', import.meta.url), 'utf8');
const row = readFileSync(new URL('./MessageRow.tsx', import.meta.url), 'utf8');

// T-121: the SAME action cluster on every message regardless of sender —
// Copy, Reply, Acknowledge, Reject — with a persistent (never opacity-0)
// three-dot anchor on desktop and always-visible on phone; structured
// reactions rendered as chips for everyone.
describe('message action cluster (T-121)', () => {
  it('keeps the three-dot anchor persistent: faint on desktop, visible on phone, never opacity-0', () => {
    expect(menu).toContain("sm:opacity-40");
    expect(menu).not.toContain('sm:opacity-0');
  });

  it('offers acknowledge and reject alongside reply and copy', () => {
    expect(menu).toContain("'Acknowledge'");
    expect(menu).toContain("'Reject'");
    expect(menu).toContain('Reply');
    expect(menu).toContain('Copy text');
    // toggle-off labels when the viewer already reacted
    expect(menu).toContain("'Remove acknowledgment'");
    expect(menu).toContain("'Remove rejection'");
  });

  it('renders the identical cluster on all three row anatomies (self, grouped, ungrouped)', () => {
    const clusters = row.match(/<MessageMenu message=\{message\} onReply=\{onReply\} onReact=\{onReact\} selfName=\{selfName\} \/>/g) ?? [];
    expect(clusters.length).toBe(3);
  });

  it('renders reaction chips on all three row anatomies', () => {
    const chips = row.match(/<ReactionChips message=\{message\} onReact=\{onReact\} selfName=\{selfName\} \/>/g) ?? [];
    expect(chips.length).toBe(3);
  });
});
