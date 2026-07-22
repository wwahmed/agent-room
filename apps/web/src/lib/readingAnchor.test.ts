// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getScrollParent, markAnchoredMutation, withinAnchoredMutation } from './readingAnchor.js';

// T-112 READING-ANCHOR RULE plumbing: the feed's bottom-pin observer yields
// while a user-initiated expansion is settling, and components find the
// scroll parent whose scrollTop they compensate.
describe('reading anchor (T-112)', () => {
  it('reports an anchored mutation only inside the settle window', () => {
    markAnchoredMutation(10_000);
    expect(withinAnchoredMutation(10_000)).toBe(true);
    expect(withinAnchoredMutation(10_599)).toBe(true);
    expect(withinAnchoredMutation(10_600)).toBe(false);
    expect(withinAnchoredMutation(20_000)).toBe(false);
  });

  it('finds the nearest scrollable ancestor and ignores non-scrolling wrappers', () => {
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    const wrapper = document.createElement('div');
    const leaf = document.createElement('button');
    wrapper.appendChild(leaf);
    scroller.appendChild(wrapper);
    document.body.appendChild(scroller);
    expect(getScrollParent(leaf)).toBe(scroller);
    expect(getScrollParent(document.body)).toBe(null);
    scroller.remove();
  });
});
