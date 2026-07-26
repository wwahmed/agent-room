import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const service = readFileSync(new URL('../../../../deploy/summoner/service.mjs', import.meta.url), 'utf8');
const server = readFileSync(new URL('../../../server/src/index.ts', import.meta.url), 'utf8');

// Host order: a blocked or dead agent must interrupt the human, not wait to be
// noticed. The summoner watchdog fires on TRANSITIONS only and the server
// accepts alerts from loopback only.
describe('agent watchdog → owner push', () => {
  it('the watchdog alerts on transitions into blocked/dead, never repeats while unchanged', () => {
    expect(service).toContain("const watchState = new Map(); // agentId -> 'ok' | 'blocked' | 'dead'");
    expect(service).toContain("if (state !== prev && state !== 'ok') {");
    expect(service).toContain('/api/agent-alert');
  });

  it('the server alert route is loopback-only and deep-links to the People pane', () => {
    expect(server).toContain("if (path === '/api/agent-alert' && req.method === 'POST') {");
    expect(server).toContain("if (alertCaller.kind !== 'local') return sendJson(res, 403,");
    expect(server).toContain('is waiting for your permission');
    expect(server).toContain('?panel=people');
  });
});
