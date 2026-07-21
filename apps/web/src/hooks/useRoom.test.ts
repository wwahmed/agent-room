import { describe, expect, it } from 'vitest';
import { friendlyError, INITIAL_PAGE_SIZE, OLDER_PAGE_SIZE, initialPageStart, olderPageRange } from './useRoom.js';

// T-07: the raw transport exception ("TypeError: Failed to fetch") was being
// rendered full-screen during room bootstrap. These pin the mapping from
// browser fetch noise to actionable copy, across engines' phrasings.
describe('friendlyError', () => {
  it('maps Chrome fetch failures to actionable copy', () => {
    expect(friendlyError(new TypeError('Failed to fetch'))).toMatch(/reach the room server/i);
  });

  it('maps Safari fetch failures to actionable copy', () => {
    expect(friendlyError(new TypeError('Load failed'))).toMatch(/reach the room server/i);
  });

  it('maps Firefox fetch failures to actionable copy', () => {
    expect(friendlyError(new TypeError('NetworkError when attempting to fetch resource.'))).toMatch(/reach the room server/i);
  });

  it('maps aborted requests to actionable copy', () => {
    expect(friendlyError(new DOMException('The operation was aborted.', 'AbortError'))).toMatch(/reach the room server/i);
  });

  it('passes real server errors through untouched', () => {
    expect(friendlyError(new Error('Room not found'))).toBe('Error: Room not found');
  });

  it('stringifies non-Error values', () => {
    expect(friendlyError('boom')).toBe('boom');
  });
});

// T-04: bounded history paging math.
describe('initialPageStart', () => {
  it('starts the window one page before the end', () => {
    expect(initialPageStart(500)).toBe(500 - INITIAL_PAGE_SIZE);
  });

  it('clamps to 0 for short histories', () => {
    expect(initialPageStart(10)).toBe(0);
    expect(initialPageStart(0)).toBe(0);
  });

  it('falls back to 0 for legacy rooms without a counter', () => {
    expect(initialPageStart(null)).toBe(0);
  });
});

describe('olderPageRange', () => {
  it('asks for the full page above the window', () => {
    expect(olderPageRange(300)).toEqual({ from: 300 - OLDER_PAGE_SIZE, count: OLDER_PAGE_SIZE });
  });

  it('clamps the first page to index 0 with a partial count', () => {
    expect(olderPageRange(30)).toEqual({ from: 0, count: 30 });
  });

  it('returns an empty range at the top of history', () => {
    expect(olderPageRange(0)).toEqual({ from: 0, count: 0 });
  });
});
