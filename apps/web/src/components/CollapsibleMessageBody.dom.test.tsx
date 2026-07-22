// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CollapsibleMessageBody } from './CollapsibleMessageBody.js';
import { withinAnchoredMutation } from '../lib/readingAnchor.js';

// T-112 READING-ANCHOR RULE: tapping Show more/Show less must keep the
// tapped button at the same viewport position — the component compensates
// its scroll parent's scrollTop by exactly how far the button moved during
// the toggle, in the same layout frame.

afterEach(cleanup);

function renderInScroller(text: string) {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  Object.defineProperty(scroller, 'scrollTop', { value: 400, writable: true });
  document.body.appendChild(scroller);
  const utils = render(<CollapsibleMessageBody text={text} />, { container: scroller });
  return { scroller, ...utils };
}

function makeCollapsible(container: HTMLElement) {
  // jsdom has no layout; give the prose block a real scrollHeight so the
  // component classifies the message as collapsible and shows the toggle.
  const prose = container.querySelector('[data-message-prose-measure] > div > div') as HTMLElement;
  Object.defineProperty(prose, 'scrollHeight', { value: 2000, configurable: true });
  // Re-fire the measurement path (ResizeObserver is absent in jsdom; the
  // effect measured once on mount with scrollHeight 0).
  return prose;
}

describe('Show more keeps the reading place (T-112)', () => {
  it('compensates the scroll parent by the button displacement and marks the anchored mutation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(50_000);
    const long = 'line\n'.repeat(400);
    const { scroller, rerender } = renderInScroller(long);
    makeCollapsible(scroller);
    rerender(<CollapsibleMessageBody text={long + ' '} />); // re-run measure effect with the stubbed scrollHeight

    const button = screen.getByRole('button', { name: 'Show more' });
    // Button sits at viewport top 500 when tapped; after expansion the grown
    // content pushed it to 900 — the compensation must scroll down by 400 so
    // the button (and the reader's place) stays put.
    const rects = [500, 900];
    vi.spyOn(button, 'getBoundingClientRect').mockImplementation(() => ({ top: rects.length > 1 ? rects.shift()! : rects[0]!, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);

    expect(withinAnchoredMutation(50_000)).toBe(false);
    fireEvent.click(button);

    expect(scroller.scrollTop).toBe(400 + 400);
    expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy();
    expect(withinAnchoredMutation(50_100)).toBe(true);
    vi.useRealTimers();
  });

  it('compensates in the collapse direction too (Show less pulls the view back up)', () => {
    const long = 'line\n'.repeat(400);
    const { scroller, rerender } = renderInScroller(long);
    makeCollapsible(scroller);
    rerender(<CollapsibleMessageBody text={long + ' '} />);

    const button = screen.getByRole('button', { name: 'Show more' });
    const rects = [500, 500, 800, 300];
    vi.spyOn(button, 'getBoundingClientRect').mockImplementation(() => ({ top: rects.length > 1 ? rects.shift()! : rects[0]!, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);

    fireEvent.click(button); // expand: 500 -> 500 (no displacement), scrollTop unchanged
    expect(scroller.scrollTop).toBe(400);
    fireEvent.click(screen.getByRole('button', { name: 'Show less' })); // collapse: 800 -> 300
    expect(scroller.scrollTop).toBe(400 - 500);
  });
});
