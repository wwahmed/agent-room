import { describe, it, expect } from 'vitest';
import { roomActivityAt } from './roomactivity.js';

describe('roomActivityAt (T-35 room-list last-activity)', () => {
  it('advances to a newer message time', () => {
    expect(roomActivityAt(1000, 2000)).toBe(2000);
  });
  it('falls back to createdAt for an empty room (no message time)', () => {
    expect(roomActivityAt(1000, undefined)).toBe(1000);
  });
  it('ignores a garbage/tiny message time that would predate the room', () => {
    expect(roomActivityAt(1783914381014, 1)).toBe(1783914381014);
  });
  it('ignores a non-finite message time', () => {
    expect(roomActivityAt(1000, NaN)).toBe(1000);
    expect(roomActivityAt(1000, Number('x'))).toBe(1000);
  });
  it('handles equal times (no strict-greater regression)', () => {
    expect(roomActivityAt(1000, 1000)).toBe(1000);
  });
  it('tolerates a missing/zero createdAt', () => {
    expect(roomActivityAt(0, 5000)).toBe(5000);
    expect(roomActivityAt(0, undefined)).toBe(0);
  });
});
