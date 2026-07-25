import { describe, expect, it } from 'vitest';
import { scrollReadCount } from './scrollRead.js';

// Scroll-past-read: the marker advances to the furthest message row fully
// above the viewport bottom — never merely because the room was opened.
describe('scrollReadCount', () => {
  const msgs = (...ids: Array<number | undefined>) => ids.map(id => ({ id }));

  it('counts every row fully above the viewport bottom', () => {
    // rows at bottoms 100/200/300; viewport bottom at 250 → two rows read
    const bottoms = new Map([[1, 100], [2, 200], [3, 300]]);
    expect(scrollReadCount(msgs(1, 2, 3), 3, 250, id => bottoms.get(id) ?? null)).toBe(2);
  });

  it('denominates in the SERVER absolute counter, not the loaded window', () => {
    // 10 total, window holds the newest 3 (positions 8..10); seeing the first
    // of them means 8 read.
    const bottoms = new Map([[8, 100], [9, 200], [10, 300]]);
    expect(scrollReadCount(msgs(8, 9, 10), 10, 150, id => bottoms.get(id) ?? null)).toBe(8);
  });

  it('a row exactly at the viewport bottom counts as read', () => {
    const bottoms = new Map([[1, 250]]);
    expect(scrollReadCount(msgs(1), 1, 250, id => bottoms.get(id) ?? null)).toBe(1);
  });

  it('skips unrendered rows (reaction transport / collapsed heartbeats) and id-less envelopes', () => {
    // id 2 never rendered, id-less envelope between 2 and 3: the scan falls
    // back to the nearest measurable row.
    const bottoms = new Map([[1, 100], [3, 400]]);
    expect(scrollReadCount(msgs(1, 2, undefined, 3), 4, 250, id => bottoms.get(id) ?? null)).toBe(1);
  });

  it('returns null when nothing measurable is above the viewport bottom', () => {
    const bottoms = new Map([[1, 500], [2, 600]]);
    expect(scrollReadCount(msgs(1, 2), 2, 250, id => bottoms.get(id) ?? null)).toBe(null);
    expect(scrollReadCount([], 0, 250, () => null)).toBe(null);
  });

  it('reads the whole window when everything is above the viewport bottom', () => {
    const bottoms = new Map([[1, 100], [2, 150]]);
    expect(scrollReadCount(msgs(1, 2), 2, 1000, id => bottoms.get(id) ?? null)).toBe(2);
  });
});
