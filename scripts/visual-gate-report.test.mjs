import { describe, expect, it } from 'vitest';
import { frameVerdict, gateSummary, CHANGE_THRESHOLD } from './visual-gate-report.mjs';

describe('frameVerdict', () => {
  it('flags a frame only past the threshold', () => {
    const total = 1_000_000;
    expect(frameVerdict('a', 0, total).changed).toBe(false);
    expect(frameVerdict('a', Math.floor(total * CHANGE_THRESHOLD), total).changed).toBe(false);
    expect(frameVerdict('a', Math.ceil(total * CHANGE_THRESHOLD) + 1, total).changed).toBe(true);
  });

  it('reports a readable percentage', () => {
    expect(frameVerdict('a', 12_500, 1_000_000).pct).toBe('1.25%');
  });
});

describe('gateSummary', () => {
  it('exits nonzero when any frame changed, zero otherwise', () => {
    const clean = gateSummary([frameVerdict('a', 0, 100)]);
    expect(clean.exitCode).toBe(0);
    const dirty = gateSummary([frameVerdict('a', 50, 100)]);
    expect(dirty.exitCode).toBe(2);
    expect(dirty.text).toContain('CHANGED a 50.00%');
  });

  it('NEW frames demand explicit baseline creation: exit 3', () => {
    const s = gateSummary([{ ...frameVerdict('b', 0, 100), baselineMissing: true }]);
    expect(s.exitCode).toBe(3);
    expect(s.text).toContain('NEW     b');
  });

  it('changed outranks new in the exit code', () => {
    const s = gateSummary([
      frameVerdict('a', 50, 100),
      { ...frameVerdict('b', 0, 100), baselineMissing: true },
    ]);
    expect(s.exitCode).toBe(2);
  });
});

describe('exit precedence integration (T-63 review)', () => {
  it('geometry (4) outranks changed (2), fresh (3), clean (0)', () => {
    const changedV = frameVerdict('a', 50, 100);
    const freshV = { ...frameVerdict('b', 0, 100), baselineMissing: true };
    const geo = [{ frame: 'a', failure: 'target under 44px' }];
    expect(gateSummary([changedV, freshV], geo).exitCode).toBe(4);
    expect(gateSummary([changedV, freshV], []).exitCode).toBe(2);
    expect(gateSummary([freshV], []).exitCode).toBe(3);
    expect(gateSummary([frameVerdict('c', 0, 100)], []).exitCode).toBe(0);
  });

  it('incomplete capture (5) outranks everything and is named in the report', () => {
    const s = gateSummary([frameVerdict('a', 50, 100)], [{ frame: 'a', failure: 'x' }], { expected: 40, captured: 12 });
    expect(s.exitCode).toBe(5);
    expect(s.text).toContain('CAPTURE-INCOMPLETE 12/40');
  });
});
