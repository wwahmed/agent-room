import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(new URL('./AgentDetailsSheet.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../lib/api.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../../../deploy/summoner/service.mjs', import.meta.url), 'utf8');
const server = readFileSync(new URL('../../../server/src/index.ts', import.meta.url), 'utf8');

// Waqas: capture agents' permission prompts and answer them from the app, so
// a harness dialog never strands an agent silently. The respond path must be
// verb-constrained, dialog-gated, and owner-authenticated end to end.
describe('permission-prompt respond flow', () => {
  it('the summoner accepts only the three verbs and refuses when no dialog is showing', () => {
    expect(service).toContain("approve: ['Enter']");
    expect(service).toContain("'approve-always': ['2', 'Enter']");
    expect(service).toContain("deny: ['Escape']");
    expect(service).toContain("if (!paneBlockedOnPrompt(a.tmuxSession)) throw httpErr(409, 'agent is not waiting on a prompt');");
  });

  it('a blocked agent ships its dialog text so the human sees what they are approving', () => {
    expect(service).toContain("...(h === 'blocked-on-prompt' ? { promptPreview: paneTail(a.tmuxSession, 28) } : {})");
    expect(api).toContain('promptPreview?: string;');
  });

  it('the respond route rides the same owner-authenticated summon proxy', () => {
    expect(server).toContain("'POST /api/summon/respond': '/respond',");
  });

  it('the details sheet shows the banner with the dialog and the three buttons', () => {
    expect(sheet).toContain('data-gate="prompt-banner"');
    expect(sheet).toContain('{agent.promptPreview && (');
    expect(sheet).toContain("onRespond('approve')");
    expect(sheet).toContain("onRespond('approve-always')");
    expect(sheet).toContain("onRespond('deny')");
  });
});
