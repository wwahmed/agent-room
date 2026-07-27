import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const room = readFileSync(new URL('./Room.tsx', import.meta.url), 'utf8');
const details = readFileSync(new URL('../components/AgentDetailsSheet.tsx', import.meta.url), 'utf8');
const summonSheet = readFileSync(new URL('../components/SummonAgentSheet.tsx', import.meta.url), 'utf8');

// Host order: removal must mean ONE thing everywhere it's clicked — stop the
// summoned process (when ours) AND free the participant row. Previously × only
// removed the row and Dismiss only killed the process, which is how ghosts
// (dismissed process, lingering row) and orphans (removed row, running
// process) were born.
describe('unified agent removal (one verb, both halves)', () => {
  it('the People-row × routes through the unified handleRemove + removalPlan', () => {
    expect(room).toContain('void handleRemove({ name: p.name, client: p.client });');
    expect(room).toContain('const plan = removalPlan(p, summonerAgents ?? []);');
    expect(room).toContain('await removeAgentFromRoom({');
    expect(room).not.toContain('handleKick');
  });

  it('the details sheet exposes the same verb, gated to the host', () => {
    expect(details).toContain('data-gate="remove-from-room"');
    expect(details).toContain('Remove from room');
    expect(room).toContain('onRemove={isHost && !ended');
  });

  it('the summon sheet dismiss also frees the participant row', () => {
    expect(summonSheet).toContain('await removeAgentFromRoom({ code, requesterName: selfName, targetName: rec.name');
  });

  it('People rows badge the PROCESS state from the summoner registry', () => {
    expect(room).toContain('const proc = processBadge(p, summonerAgents, presence?.state ?? null);');
  });

  it('a one-shot sweep on room open clears ghost rows (dismissed process + disconnected)', () => {
    expect(room).toContain('const sweptGhostsRef = useRef(false);');
    expect(room).toContain('const ghosts = staleAgentRows(');
  });
});
