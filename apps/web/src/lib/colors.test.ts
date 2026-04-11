import { describe, it, expect } from 'vitest';
import { colorForName, initialsFor } from './colors.js';
import { AVATAR_PALETTE } from '@agent-room/shared';

describe('colorForName', () => {
  it('returns a color from the palette', () => {
    expect(AVATAR_PALETTE).toContain(colorForName('Alex Chen'));
  });

  it('is deterministic for the same name', () => {
    expect(colorForName('Alex Chen')).toBe(colorForName('Alex Chen'));
  });

  it('distributes different names across the palette (probabilistic)', () => {
    const colors = new Set(
      ['Alex Chen', 'Sarah Kim', 'Jordan Lee', 'Mei Wang', 'Kai Tanaka', 'Priya Rao']
        .map(colorForName)
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('initialsFor', () => {
  it('takes first letter of first two words, uppercased', () => {
    expect(initialsFor('Alex Chen')).toBe('AC');
    expect(initialsFor('jordan lee')).toBe('JL');
  });
  it('falls back to first two letters for single-word names', () => {
    expect(initialsFor('Alex')).toBe('AL');
  });
  it('returns ?? for empty input', () => {
    expect(initialsFor('')).toBe('??');
  });
});
