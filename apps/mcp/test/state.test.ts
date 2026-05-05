import { describe, expect, it } from 'vitest';
import { mergeStates, type AgentRoomState } from '../src/state.js';

describe('mergeStates', () => {
  it('keeps the highest cursor for rooms found in multiple PPID state files', () => {
    const older: AgentRoomState = {
      version: 1,
      blockStreak: 2,
      rooms: {
        'GBX-YXT-C3R': {
          name: 'Cursor',
          cursor: 10,
          joinedAt: 100,
        },
      },
    };
    const newer: AgentRoomState = {
      version: 1,
      blockStreak: 5,
      rooms: {
        'GBX-YXT-C3R': {
          name: 'Cursor',
          cursor: 14,
          joinedAt: 200,
          lastSentAt: 300,
        },
      },
    };

    expect(mergeStates([older, newer])).toEqual({
      version: 1,
      blockStreak: 5,
      rooms: {
        'GBX-YXT-C3R': {
          name: 'Cursor',
          cursor: 14,
          joinedAt: 200,
          lastSentAt: 300,
        },
      },
    });
  });

  it('preserves separate rooms while merging block streaks', () => {
    const first: AgentRoomState = {
      version: 1,
      blockStreak: 1,
      rooms: {
        'AAA-BBB-CCC': { name: 'Cursor', cursor: 2, joinedAt: 100 },
      },
    };
    const second: AgentRoomState = {
      version: 1,
      blockStreak: 3,
      rooms: {
        'DDD-EEE-FFF': { name: 'Cursor', cursor: 7, joinedAt: 200 },
      },
    };

    expect(mergeStates([first, second])).toEqual({
      version: 1,
      blockStreak: 3,
      rooms: {
        'AAA-BBB-CCC': { name: 'Cursor', cursor: 2, joinedAt: 100 },
        'DDD-EEE-FFF': { name: 'Cursor', cursor: 7, joinedAt: 200 },
      },
    });
  });
});
