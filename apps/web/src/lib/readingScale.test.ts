import { describe, expect, it } from 'vitest';
import {
  READING_SCALE_DEFAULT,
  applyReadingScale,
  currentReadingScale,
  isReadingScale,
  resolveReadingScale,
  setReadingScale,
} from './readingScale.js';

describe('resolveReadingScale', () => {
  it('defaults to comfortable with no stored choice', () => {
    expect(resolveReadingScale(null)).toBe('comfortable');
    expect(READING_SCALE_DEFAULT).toBe('comfortable');
  });

  it('honors every explicit stored choice', () => {
    expect(resolveReadingScale('large')).toBe('large');
    expect(resolveReadingScale('compact')).toBe('compact');
    expect(resolveReadingScale('comfortable')).toBe('comfortable');
  });

  it('rejects junk values back to the default', () => {
    expect(resolveReadingScale('huge')).toBe('comfortable');
    expect(resolveReadingScale('')).toBe('comfortable');
  });

  it('type guard matches only the three scales', () => {
    expect(isReadingScale('large')).toBe(true);
    expect(isReadingScale('LARGE')).toBe(false);
    expect(isReadingScale(17)).toBe(false);
  });
});

describe('persistence + application (node-guarded)', () => {
  it('setReadingScale persists so currentReadingScale reads it back', () => {
    setReadingScale('large');
    expect(currentReadingScale()).toBe('large');
    setReadingScale('comfortable');
    expect(currentReadingScale()).toBe('comfortable');
  });

  it('applyReadingScale is inert without a document', () => {
    expect(() => applyReadingScale('compact')).not.toThrow();
  });
});
