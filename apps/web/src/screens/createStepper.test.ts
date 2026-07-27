import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const create = readFileSync(new URL('./CreateMeeting.tsx', import.meta.url), 'utf8');

// T-09: the create page is a three-step stepper, not a newspaper scroll.
// Source-contract tests in the same style as createTeaching.test.ts.
describe('create page — three-step stepper', () => {
  it('renders a worded stepper rail and one section per step', () => {
    expect(create).toContain('data-gate="create-stepper"');
    for (const gate of ['step-type', 'step-details', 'step-review']) {
      expect(create).toContain(`data-gate="${gate}"`);
    }
    // Steps appear in walk order in source (type → details → review).
    expect(create.indexOf('step-type')).toBeLessThan(create.indexOf('step-details'));
    expect(create.indexOf('step-details')).toBeLessThan(create.indexOf('step-review'));
  });

  it('Enter mid-flow advances the stepper — it never creates from a half-reviewed form', () => {
    expect(create).toContain("if (step !== 3) { goTo((step + 1) as StepN); return; }");
  });

  it('forward past Details is gated on a valid room name; back is always free', () => {
    expect(create).toContain('if (next > 2 && step >= 2 && !detailsOk)');
    expect(create).toContain('disabled={step === 2 && !detailsOk}');
  });

  it('review rows link every fact back to the step that owns it', () => {
    expect(create).toContain('reviewRows.map');
    expect(create).toContain('onClick={() => goTo(r.step)}');
  });

  it('the compact type cards show when-to-use copy only on the selected card', () => {
    expect(create).toContain('{active && (');
    expect(create).toContain('{t.whenToUse}');
  });
});
