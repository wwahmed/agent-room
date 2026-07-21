import { describe, expect, it } from 'vitest';
import { isAutoTestRoom, splitRooms } from './roomSections.js';

describe('isAutoTestRoom', () => {
  it('matches the explicit conventions', () => {
    expect(isAutoTestRoom('T-04 paging smoke (auto test room, safe to ignore)')).toBe(true);
    expect(isAutoTestRoom('scratch (safe to ignore)')).toBe(true);
  });

  it('matches task-probe topics', () => {
    expect(isAutoTestRoom('T32 verifier probe')).toBe(true);
    expect(isAutoTestRoom('T-32 rev3 credential smoke')).toBe(true);
    expect(isAutoTestRoom('T-32 rev4 live check')).toBe(true);
  });

  it('never collapses real rooms', () => {
    expect(isAutoTestRoom('Build: WakiChat')).toBe(false);
    expect(isAutoTestRoom('Build: WakiDrive EV Nav')).toBe(false);
    // Probe vocabulary without a leading task id stays visible.
    expect(isAutoTestRoom('Smoke detector installation plan')).toBe(false);
    // A task id without probe vocabulary stays visible.
    expect(isAutoTestRoom('T-38 design charter sync')).toBe(false);
  });
});

describe('splitRooms', () => {
  it('routes by status and test-ness', () => {
    const rooms = [
      { status: 'active', topic: 'Build: WakiChat' },
      { status: 'active', topic: 'T32 verifier probe' },
      { status: 'ended', topic: 'Old planning room' },
      { status: 'ended', topic: 'T-32 rev4 live check' },
    ];
    const s = splitRooms(rooms);
    expect(s.active.map(r => r.topic)).toEqual(['Build: WakiChat']);
    expect(s.activeTest.map(r => r.topic)).toEqual(['T32 verifier probe']);
    expect(s.ended.map(r => r.topic)).toEqual(['Old planning room']);
    expect(s.endedTest.map(r => r.topic)).toEqual(['T-32 rev4 live check']);
  });
});
