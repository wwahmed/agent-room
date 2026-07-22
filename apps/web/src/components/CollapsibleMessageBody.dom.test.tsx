// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CollapsibleMessageBody } from './CollapsibleMessageBody.js';
import { withinAnchoredMutation } from '../lib/readingAnchor.js';

// T-112 rev2 READING-ANCHOR RULE (corrected contract): the anchor is the
// READ/UNREAD BOUNDARY — the content container that carries the collapsed
// preview. The container's viewport top must not move across the toggle, so
// the last line read stays put and the revealed text continues below it.
// The button is explicitly NOT the anchor (pinning it opened the reveal
// above the reading line — the defect the host's frames showed).

afterEach(cleanup);

function renderInScroller(text: string) {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  Object.defineProperty(scroller, 'scrollTop', { value: 400, writable: true });
  document.body.appendChild(scroller);
  const utils = render(<CollapsibleMessageBody text={text} />, { container: scroller });
  return { scroller, ...utils };
}

function stubContainerTops(scroller: HTMLElement, tops: number[]) {
  const container = scroller.querySelector('[data-message-prose-measure]') as HTMLElement;
  vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => ({ top: tops.length > 1 ? tops.shift()! : tops[0]!, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
  return container;
}

function makeCollapsible(scroller: HTMLElement) {
  const prose = scroller.querySelector('[data-message-prose-measure] > div > div') as HTMLElement;
  Object.defineProperty(prose, 'scrollHeight', { value: 2000, configurable: true });
}

describe('Show more anchors the read/unread boundary (T-112 rev2)', () => {
  it('holds the content container still when something shifts it, and marks the anchored mutation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(50_000);
    const long = 'line\n'.repeat(400);
    const { scroller, rerender } = renderInScroller(long);
    makeCollapsible(scroller);
    rerender(<CollapsibleMessageBody text={long + ' '} />);

    // Container at viewport top 200 when tapped; a reflow pushed it to 260
    // after expansion — compensation must scroll by +60 to hold the boundary.
    stubContainerTops(scroller, [200, 260]);
    expect(withinAnchoredMutation(50_000)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));

    expect(scroller.scrollTop).toBe(400 + 60);
    expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy();
    expect(withinAnchoredMutation(50_100)).toBe(true);
    vi.useRealTimers();
  });

  it('leaves scroll untouched when the container already held (content revealed below the boundary)', () => {
    const long = 'line\n'.repeat(400);
    const { scroller, rerender } = renderInScroller(long);
    makeCollapsible(scroller);
    rerender(<CollapsibleMessageBody text={long + ' '} />);

    // Each toggle reads the rect three times: anchor at click, delta after
    // commit, and the stranded-reader guard.
    stubContainerTops(scroller, [200, 200, 200, 200, 90, 90]);
    fireEvent.click(screen.getByRole('button', { name: 'Show more' })); // 200 -> 200: no compensation
    expect(scroller.scrollTop).toBe(400);
    fireEvent.click(screen.getByRole('button', { name: 'Show less' })); // 200 -> 90: compensate -110
    expect(scroller.scrollTop).toBe(400 - 110);
  });
});
