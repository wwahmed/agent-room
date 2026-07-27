import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const room = readFileSync(new URL('../screens/Room.tsx', import.meta.url), 'utf8');

// T-17: People rows surface each participant's claimed board work.
describe('Current work on People rows — who is on what, without a tab hop', () => {
  it('the row derives its chip from the board pulse: in_progress + owner match', () => {
    expect(room).toContain('data-gate="current-work"');
    expect(room).toContain("t.state === 'in_progress' && t.owner === p.name");
    // ownerClient narrows the match when present; legacy tasks without it still show.
    expect(room).toContain('!t.ownerClient || t.ownerClient === p.client');
  });

  it('tapping the chip opens the Board tab', () => {
    const chip = room.slice(room.indexOf('data-gate="current-work"'));
    expect(chip.slice(0, 400)).toContain("selectTab('project')");
  });

  it('viewers never wear a work chip', () => {
    const block = room.slice(room.indexOf('T-17: what this participant is DOING'));
    expect(block.slice(0, 800)).toContain('p.viewer === true) return null');
  });
});
