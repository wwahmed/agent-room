import { describe, expect, it } from 'vitest';
import { relativeTime, messageTime } from './relativeTime.js';

const NOW = 1_700_000_000_000;
const mins = (n: number) => NOW - n * 60_000;
const hrs = (n: number) => NOW - n * 3_600_000;
const days = (n: number) => NOW - n * 86_400_000;

describe('messageTime', () => {
  it('reads sub-minute as "now"', () => {
    expect(messageTime(NOW, NOW)).toBe('now');
    expect(messageTime(NOW - 30_000, NOW)).toBe('now');
  });
  it('reads recent minutes verbosely with singular/plural', () => {
    expect(messageTime(mins(1), NOW)).toBe('1 minute ago');
    expect(messageTime(mins(2), NOW)).toBe('2 minutes ago');
    expect(messageTime(mins(59), NOW)).toBe('59 minutes ago');
  });
  it('settles to a clock time past an hour (same day)', () => {
    expect(messageTime(hrs(2), NOW)).not.toMatch(/ago/);
    expect(messageTime(hrs(2), NOW)).toMatch(/\d/);
  });
  it('includes a date for older days', () => {
    const older = messageTime(days(3), NOW);
    expect(older).not.toMatch(/ago/);
    expect(older).toMatch(/,/); // "Mon D, H:MM ..."
  });
  it('handles missing/NaN as empty and clock-skew as now', () => {
    expect(messageTime(undefined, NOW)).toBe('');
    expect(messageTime(NaN, NOW)).toBe('');
    expect(messageTime(NOW + 5_000, NOW)).toBe('now');
  });
});

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
