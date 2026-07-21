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
