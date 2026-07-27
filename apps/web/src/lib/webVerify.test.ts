import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(new URL('../components/ProjectPanel.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');

// T-19: the web verifier can actually rule — evidence + verdict on the Board.
describe('Web verify — evidence and verdict live on the Board tab', () => {
  it('awaiting-review cards fold out the submitted evidence and the DoD', () => {
    expect(panel).toContain('data-gate="task-evidence"');
    expect(panel).toContain('t.evidence.fileListing');
    expect(panel).toContain('t.evidence.runOutput');
    expect(panel).toContain("['Excerpt', t.evidence.fileExcerpt]");
    expect(panel).toContain('Done when');
  });

  it('verdict controls render only for the eligible verifier and mirror the board rules', () => {
    expect(panel).toContain('data-gate="task-verify"');
    // never the owner; designated verifier wins; open verify otherwise
    expect(panel).toContain("if (t.owner && t.owner === selfName) return false;");
    expect(panel).toContain("t.verifier && t.verifier !== t.owner ? t.verifier : null");
    expect(panel).toContain("designated ? designated === selfName : true");
    // done confirms, reject collects the rework note
    expect(panel).toContain('window.confirm(`Verify ${t.id} as DONE?');
    expect(panel).toContain('window.prompt(`Reject ${t.id}');
  });

  it('the API presents the member credential on taskVerify', () => {
    expect(api).toContain("action: 'taskVerify'");
    expect(api.slice(api.indexOf("action: 'taskVerify'"))).toContain('memberKey: mk');
  });
});
