import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const room = readFileSync(new URL('./Room.tsx', import.meta.url), 'utf8');

// The host's report: an agent went quiet, and the only thing People offered was
// a prompt to copy into a terminal. He woke it by hand, closed the terminal,
// and it went quiet again. The app owns the launch spec, so the row should act.
describe('People-row agent recovery', () => {
  it('binds the shared context-menu gesture to agent rows only', () => {
    expect(room).toContain('useAgentRowMenu()');
    expect(room).toContain('bindAgentMenu({ name: p.name, role: p.role, client: p.client })');
    // A browser tab has no process to revive and a viewer is nobody's alarm.
    expect(room).toContain("p.client === 'cc' && p.viewer !== true");
    expect(room).toContain('<AgentContextMenu');
  });

  it('offers to bring the agent back rather than handing the host homework', () => {
    expect(room).toContain('data-gate="row-bring-back"');
    expect(room).toContain('Bring it back');
    // Level comes from the agent's own record, never a default: a revive must
    // not quietly re-permission the agent.
    expect(room).toContain('reviveCapability(newestAgentFor(summonerAgents ?? [], p.name))');
    expect(room).toContain('bringBackFromRow(p.name, cap.agentId, cap.mode)');
  });

  it('keeps copy-a-message only where the app genuinely cannot act', () => {
    // Adopted / invite-code agents: the summoner has no spec to re-run.
    expect(room).toContain('data-gate="row-wake-message"');
    expect(room).toContain('Copy wake message');
    // The old unconditional button and its terminal-first phrasing are gone.
    expect(room).not.toContain('Copy recovery prompt');
  });

  it('refreshes the summoner records after a revive so the row stops lying', () => {
    expect(room).toContain('await refreshSummonerAgents();');
  });
});
