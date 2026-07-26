import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(new URL('./SummonAgentSheet.tsx', import.meta.url), 'utf8');

// Waqas: the summon screen must teach top-to-bottom (who → where → what it may
// do) and the confirmation must show real progress, not switch screens on the
// API call and declare victory before the agent has joined.
describe('summon sheet — guided flow with honest progress', () => {
  it('walks three numbered steps in order', () => {
    const who = sheet.indexOf('>Who</span>');
    const where = sheet.indexOf('>Where</span>');
    const what = sheet.indexOf('>What it may do</span>');
    expect(who).toBeGreaterThan(-1);
    expect(where).toBeGreaterThan(who);
    expect(what).toBeGreaterThan(where);
  });

  it('confirmation polls until the agent is really present, staged', () => {
    expect(sheet).toContain('data-gate="summon-progress"');
    expect(sheet).toContain("['Joined the room', inRoom]");
    expect(sheet).toContain('if (room?.participants.some((p) => p.name === justSummoned.name)) setInRoom(true);');
  });

  it('a launch-time permission dialog surfaces instead of hanging the spinner', () => {
    expect(sheet).toContain("justSummoned.health === 'blocked-on-prompt'");
    expect(sheet).toContain('Waiting for your permission');
  });
});
