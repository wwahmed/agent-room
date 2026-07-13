import { describe, it, expect } from 'vitest';
import {
  parseCode,
  isValidCode,
  canonicalizeCode,
  generateRoomCode,
  generateCode,
} from './codeGen.js';

describe('T-47 parseCode — format detection + canonicalization', () => {
  it('parses a word code to lowercase-dashed canonical', () => {
    expect(parseCode('door-cat-hall')).toEqual({ canonical: 'door-cat-hall', format: 'words' });
    expect(parseCode('DOOR-CAT-HALL')).toEqual({ canonical: 'door-cat-hall', format: 'words' });
    expect(parseCode('  Door-Cat-Hall  ')).toEqual({ canonical: 'door-cat-hall', format: 'words' });
  });

  it('parses a legacy code to UPPER-dashed canonical (both input cases)', () => {
    // The room this all runs in — must never stop resolving.
    expect(parseCode('D64-2UJ-FNR')).toEqual({ canonical: 'D64-2UJ-FNR', format: 'legacy' });
    expect(parseCode('d64-2uj-fnr')).toEqual({ canonical: 'D64-2UJ-FNR', format: 'legacy' });
  });

  it('tolerates spaces/underscores as separators', () => {
    expect(parseCode('door cat hall')?.canonical).toBe('door-cat-hall');
    expect(parseCode('d64_2uj_fnr')?.canonical).toBe('D64-2UJ-FNR');
  });

  it('rejects structurally invalid input', () => {
    for (const bad of ['', 'nope', 'door-cat', 'door-cat-hall-extra', 'toolong-cat-hall',
      'DO-2UJ-FNR', 'door-ca-hall', '12-34-56', 'do0r-cat-hall']) {
      expect(parseCode(bad)).toBeNull();
    }
    // legacy alphabet excludes I/L/O/0/1 — a segment using them is not legacy
    expect(parseCode('OIL-2UJ-FNR')).toBeNull();
  });

  it('word and legacy shapes never collide', () => {
    expect(parseCode('door-cat-hall')!.format).toBe('words');
    expect(parseCode('D64-2UJ-FNR')!.format).toBe('legacy');
  });
});

describe('T-47 isValidCode / canonicalizeCode', () => {
  it('isValidCode accepts BOTH formats, rejects junk', () => {
    expect(isValidCode('door-cat-hall')).toBe(true);
    expect(isValidCode('D64-2UJ-FNR')).toBe(true);
    expect(isValidCode('d64-2uj-fnr')).toBe(true);
    expect(isValidCode('nonsense')).toBe(false);
  });

  it('canonicalizeCode returns the routing form or null', () => {
    expect(canonicalizeCode('DOOR-CAT-HALL')).toBe('door-cat-hall');
    expect(canonicalizeCode('d64-2uj-fnr')).toBe('D64-2UJ-FNR');
    expect(canonicalizeCode('bad')).toBeNull();
  });
});

describe('T-47 generateRoomCode', () => {
  it('produces a valid, canonical word code', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateRoomCode();
      const parsed = parseCode(c);
      expect(parsed).not.toBeNull();
      expect(parsed!.format).toBe('words');
      expect(parsed!.canonical).toBe(c); // already canonical
    }
  });

  it('never emits an embarrassing combo', () => {
    const bad = ['anal', 'fuck', 'shit', 'rape', 'sex', 'nigg', 'cock', 'tit'];
    for (let i = 0; i < 2000; i++) {
      const run = generateRoomCode().replace(/-/g, '');
      for (const b of bad) expect(run.includes(b)).toBe(false);
    }
  });

  it('retries past taken codes and honors isTaken', () => {
    const seen = new Set<string>();
    let calls = 0;
    // Reject the first two candidates, accept the third.
    const code = generateRoomCode({
      isTaken: () => { calls += 1; return calls <= 2; },
    });
    expect(isValidCode(code)).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
    seen.add(code);
  });

  it('throws when it cannot allocate within maxAttempts', () => {
    expect(() => generateRoomCode({ isTaken: () => true, maxAttempts: 5 })).toThrowError(/allocate/);
  });

  it('legacy generateCode still emits a valid legacy code', () => {
    const c = generateCode();
    expect(parseCode(c)!.format).toBe('legacy');
    expect(c).toBe(c.toUpperCase());
  });
});
