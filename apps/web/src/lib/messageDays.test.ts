import { describe, expect, it } from 'vitest';
import type { Message } from '@agent-room/shared';
import { messageDayKey, messageDayLabel, startsMessageDay } from './messageDays.js';

function message(id: number, time: number): Message {
  return { id, type: 'msg', name: 'Agent', initials: 'A', color: '#000', client: 'cc', role: '', text: '', time };
}

describe('message day dividers', () => {
  const now = new Date(2026, 6, 20, 18).getTime();

  it('keys dates in local calendar time', () => {
    expect(messageDayKey(new Date(2026, 6, 20, 1).getTime())).toBe('2026-6-20');
  });

  it('starts the loaded window and each new calendar day', () => {
    const first = message(1, new Date(2026, 6, 19, 23).getTime());
    const next = message(2, new Date(2026, 6, 20, 0, 1).getTime());
    expect(startsMessageDay(undefined, first)).toBe(true);
    expect(startsMessageDay(first, next)).toBe(true);
    expect(startsMessageDay(next, message(3, next.time + 1_000))).toBe(false);
  });

  it('uses useful relative labels without hiding older dates', () => {
    expect(messageDayLabel(now, now)).toBe('Today');
    expect(messageDayLabel(new Date(2026, 6, 19, 9).getTime(), now)).toBe('Yesterday');
    expect(messageDayLabel(new Date(2025, 11, 1).getTime(), now)).toContain('2025');
  });
});
