import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(new URL('./SummonAgentSheet.tsx', import.meta.url), 'utf8');

// The first view is intentionally compact: only decisions required to launch
// remain visible; diagnostics and low-frequency switches live in Advanced.
describe('summon sheet — compact launch with honest progress', () => {
  it('keeps required choices in one compact form and secondary controls advanced', () => {
    for (const label of ['Provider', 'Model', 'Agent name', 'Workspace', 'Access']) {
      expect(sheet).toContain(`>${label}</label>`);
    }
    expect(sheet).toContain('<span>Advanced</span>');
    expect(sheet).not.toContain('>Who</span>');
    expect(sheet).not.toContain('Summoned in this room');
  });

  it('uses a full-height, safe-area-aware mobile sheet with large controls', () => {
    expect(sheet).toContain('h-[100dvh] max-h-[100dvh]');
    expect(sheet).toContain('pb-[max(1.5rem,env(safe-area-inset-bottom))]');
    expect(sheet).toContain('min-h-14 rounded-2xl');
    expect(sheet).toContain('text-2xl');
    expect(sheet).toContain('sm:h-auto sm:max-h-[92dvh]');
    expect(sheet).toContain('shrink-0 border-t border-border-faint bg-surface');
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
