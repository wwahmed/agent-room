import { describe, expect, it } from 'vitest';
import { friendlyError } from './useRoom.js';

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
