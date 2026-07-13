import { describe, expect, it } from 'vitest';
import { relativeTime } from './relativeTime.js';

const NOW = 1_700_000_000_000;
const mins = (n: number) => NOW - n * 60_000;
const hrs = (n: number) => NOW - n * 3_600_000;
const days = (n: number) => NOW - n * 86_400_000;

describe('relativeTime', () => {
  it('renders sub-minute as "now"', () => {
    expect(relativeTime(NOW, NOW)).toBe('now');
    expect(relativeTime(NOW - 30_000, NOW)).toBe('now');
  });
  it('renders minutes / hours / days', () => {
    expect(relativeTime(mins(5), NOW)).toBe('5m');
    expect(relativeTime(mins(59), NOW)).toBe('59m');
    expect(relativeTime(hrs(3), NOW)).toBe('3h');
    expect(relativeTime(hrs(23), NOW)).toBe('23h');
    expect(relativeTime(days(2), NOW)).toBe('2d');
    expect(relativeTime(days(6), NOW)).toBe('6d');
  });
  it('renders a short date past a week', () => {
    // 10 days ago → a "Mon D" style date, not "10d"
    expect(relativeTime(days(10), NOW)).not.toMatch(/^\d+d$/);
    expect(relativeTime(days(10), NOW)).toMatch(/\d/);
  });
  it('handles missing / non-finite input as empty', () => {
    expect(relativeTime(undefined, NOW)).toBe('');
    expect(relativeTime(NaN, NOW)).toBe('');
  });
  it('treats small clock-skew negatives as "now"', () => {
    expect(relativeTime(NOW + 5_000, NOW)).toBe('now');
  });
});
