import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(new URL('../components/ProjectPanel.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');

// T-28: "verified" and "live" are different facts. A reviewed task that was
// never promoted must not read as finished — the 3dbypixel nav/Home work sat
// verified-and-invisible for days because the board had no way to say it.
describe('Deploy gate — a verified task without live proof says so', () => {
  it('a done task with no liveRef renders the not-deployed warning and an action', () => {
    expect(panel).toContain('data-gate="not-deployed"');
    expect(panel).toContain("t.state === 'done' && !t.liveRef");
    expect(panel).toContain('Verified, not deployed');
    expect(panel).toContain('Mark deployed…');
  });

  it('a task carrying live proof shows what is actually live, with who recorded it', () => {
    expect(panel).toContain('data-gate="deployed"');
    expect(panel).toContain('t.liveRef && (');
    expect(panel).toContain('t.deployedBy');
  });

  it('marking deployed demands a real reference and posts it with the credential', () => {
    expect(panel).toContain('window.prompt(`Mark ${t.id} DEPLOYED');
    expect(panel).toContain("showToast('A live reference is required', 'error')");
    expect(api).toContain("action: 'taskMarkDeployed'");
    expect(api.slice(api.indexOf("action: 'taskMarkDeployed'"))).toContain('memberKey: mk');
  });
});
