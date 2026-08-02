import { readFileSync } from 'node:fs';
import type { Participant } from '@agent-room/shared';
import { describe, expect, it } from 'vitest';

import { participantHealth, presenceState } from './health.js';

const serverIndex = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const rooms = readFileSync(new URL('../../../packages/upstash-client/src/rooms.ts', import.meta.url), 'utf8');
const summoner = readFileSync(new URL('../../../deploy/summoner/service.mjs', import.meta.url), 'utf8');
const presenceLib = readFileSync(new URL('../../web/src/lib/presence.ts', import.meta.url), 'utf8');

const NOW = 1_700_000_000_000;
function row(over: Partial<Participant> = {}): Participant {
  return {
    name: 'OpusCoder', role: '', color: '#000', initials: 'OP', client: 'cc',
    joinedAt: NOW - 3_600_000, lastSeenAt: NOW - 2_400_000, // 40 minutes silent
    ...over,
  };
}

// T-36: observed live — an agent read `disconnected` to the host for ~40 minutes
// of continuous work while its summoner vetoed 13 nudges, because the summoner
// could see the terminal working and the room could not. The room was telling the
// host the opposite of what the machinery already knew.
describe('Terminal-vouched work window', () => {
  it('turns a 40-minute-silent row into `working` without pretending we heard from it', () => {
    const silent = row();
    expect(presenceState(silent, NOW)).toBe('disconnected');

    const vouched = row({ workingUntil: NOW + 60_000, workingBy: 'terminal' });
    const h = participantHealth(vouched, NOW);
    expect(h.state).toBe('working');
    expect(h.workingBy).toBe('terminal');
    // The honesty that matters: "last heard" is untouched, so the host still sees
    // 40 minutes of silence next to the working verdict. Bumping it would have
    // been the easy lie.
    expect(h.lastSeenAgoMs).toBe(2_400_000);
  });

  it('the writer never touches lastSeenAt, unlike the self-declared path', () => {
    const terminal = rooms.slice(rooms.indexOf('export async function setTerminalWorking'));
    const body = terminal.slice(0, terminal.indexOf('}));'));
    expect(body).toContain("workingBy: 'terminal' as const");
    expect(body).not.toContain('lastSeenAt');
    // The self path DOES bump it, correctly — we genuinely heard from the agent.
    const self = rooms.slice(rooms.indexOf('export async function setWorkingUntil'));
    expect(self.slice(0, self.indexOf('}));'))).toContain('lastSeenAt: Date.now()');
  });

  it('provenance is reported only while the row actually reads working', () => {
    // A stale workingBy on an expired window must not leak a claim about a state
    // the row is no longer in.
    const expired = row({ workingUntil: NOW - 1, workingBy: 'terminal' });
    expect(participantHealth(expired, NOW).state).not.toBe('working');
    expect(participantHealth(expired, NOW).workingBy).toBeUndefined();
    // And a junk value is not passed through to the UI.
    const junk = row({ workingUntil: NOW + 60_000, workingBy: 'sneaky' as unknown as 'self' });
    expect(participantHealth(junk, NOW).workingBy).toBeUndefined();
  });

  it('the endpoint is loopback-only, code-validated, and window-capped', () => {
    const ep = serverIndex.slice(serverIndex.indexOf("'/api/agent-terminal-working'"));
    const handler = ep.slice(0, 2200);
    // No remote caller may vouch for an agent it cannot see.
    expect(handler).toContain("twCaller.kind !== 'local'");
    expect(handler).toContain('loopback only');
    // canonicalizeCode returns null for junk; it must be validated, not stored.
    expect(handler).toContain('a valid room code are required');
    // A frozen harness must stop reading as working within ~2 minutes.
    expect(handler).toContain('TERMINAL_WORKING_MAX_MS');
    expect(serverIndex).toContain('const TERMINAL_WORKING_MAX_MS = 120_000;');
  });

  it('the summoner vouches from exactly the branch where it vetoes the nudge', () => {
    // One decision, one place: the evidence that justifies not typing into the
    // pane is the same evidence that justifies the working window.
    const veto = summoner.slice(summoner.indexOf('nudge vetoed'));
    expect(veto.slice(0, 900)).toContain('/api/agent-terminal-working');
    expect(veto.slice(0, 900)).toContain('forMs: 120000');
  });

  it('the copy says a terminal vouched, never that the agent declared it', () => {
    expect(presenceLib).toContain("'not listening · terminal shows a live turn'");
    expect(presenceLib).toContain("'not listening · heads-down in a declared work window'");
  });
});
