import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const room = readFileSync(new URL('./Room.tsx', import.meta.url), 'utf8');

describe('phone chat overlays do not obscure conversation content', () => {
  it('gives the phone header and pinned control real non-scrolling layout rows', () => {
    expect(room).toContain('data-gate="mobile-header-clearance"');
    expect(room).toContain('h-[104px] flex-shrink-0');
    expect(room).toContain('data-gate="pinned-strip"');
    expect(room).toContain('flex flex-shrink-0 justify-center');
    expect(room).toContain('paddingTop: 0');
    expect(room).toContain('data-gate="feed" className="relative min-h-0 flex-1 overflow-y-auto');
    expect(room).toContain('className="mx-auto flex min-h-11 items-center');
  });

  it('keeps pinned actions at the 44px phone touch floor', () => {
    expect(room.match(/className="flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-lg/g)?.length).toBeGreaterThanOrEqual(2);
  });

  // Reversed deliberately by the host: "look how much space this arrow button
  // wastes. It could just be a hover in the middle." T-72's reserved lane cost
  // a band of conversation on every screen where the control appears, which on
  // a phone is most of them while reading back.
  //
  // The invariant T-72 actually protected is NOT "reserve a lane" — it is "a
  // message must not be permanently hidden behind an overlay". That still
  // holds, by two mechanisms asserted below: Latest renders only while away
  // from the bottom (so it cannot cover the newest message being read), and
  // the container passes input through to the text underneath.
  it('floats Latest without reserving layout, centred at every breakpoint', () => {
    expect(room).toContain('room-latest-lane pointer-events-none absolute inset-x-0 bottom-full z-[25]');
    expect(room).toContain('items-center justify-center gap-2');
    // No layout reservation: the lane must not be a flex child with width.
    expect(room).not.toContain('room-latest-lane z-[25] flex w-full flex-shrink-0');
    // Not right-aligned on phones any more — the host asked for the middle.
    expect(room).not.toContain('sm:justify-center sm:px-4"');
    // Composer clearances are unrelated to this control and must survive.
    expect(room).toContain('data-gate="desktop-composer-clearance"');
    expect(room).toContain('max-sm:w-11 max-sm:px-0');
    expect(room).toContain('className="hidden sm:inline"');
    expect(room).toContain('className="tabular-nums sm:hidden"');
  });

  it('keeps the floating control from swallowing taps meant for the message under it', () => {
    // Container off, pills on. Without this the overlay would block scrolling
    // and text selection across the full width of the conversation.
    expect(room).toContain('room-latest-lane pointer-events-none');
    // Anchored to the composer itself (bottom-full), so it tracks the chrome
    // through the immersive slide instead of guessing an offset from state.
    // NOTE: no `relative` utility here. .room-bottom-chrome is position:absolute
    // on phones via CSS; adding `relative` overrode it, dropped the composer into
    // normal flow, and turned the existing composer-clearance spacer into 122px
    // of dead band between the last message and the composer. position:absolute
    // is itself a containing block, so bottom-full anchoring still works.
    expect(room).toContain('room-bottom-chrome sm:absolute');
    expect(room).not.toContain('room-bottom-chrome relative');
    expect(room).toContain('className="pointer-events-auto flex min-h-11 w-fit items-center');
  });

  it('only shows Latest while the reader is away from the bottom', () => {
    // This is what makes floating safe: the control cannot obscure the newest
    // message, because it does not exist while you are reading it.
    expect(room).toContain('{(unseenCount > 0 || !atBottom || selfMentionIds.length > 0) && (');
  });

  // Reservation moved INSIDE the scrollport. A sibling spacer had only bad
  // options: unmount it on chrome-hide and the conversation jerks; keep it and
  // immersive mode shows a dead band. Padding below the last message does
  // neither — it cannot move content above it, and it collapses with the chrome.
  it('reserves the composer height as padding inside the scrollport', () => {
    expect(room).toContain('paddingBottom: composerH + 16');
    expect(room).not.toContain('data-gate="mobile-composer-clearance"');
  });

  // Host order: "if the header and footer move away, they should NOT move the
  // reading position." Feed geometry must be identical in both chrome states,
  // so nothing downstream has a change to react to. Collapsing the padding
  // with the chrome looks free and is not: it moves scrollHeight, which the
  // tail anchor turned into a composer-sized jump and which reads a
  // mid-history reader as "at bottom", forcing the chrome straight back.
  it('keeps feed geometry identical whether or not the chrome is showing', () => {
    expect(room).not.toContain('paddingBottom: chromeHidden');
    expect(room).not.toContain('chromeHidden ? 16');
    // The clearance ABOVE the feed still unmounts, so the anchor has to carry
    // clientHeight too — that delta is the 104px the reader would otherwise
    // lose on every toggle. Position is compensated, never re-derived.
    expect(room).toContain('chromeTopAnchorRef.current = { top: feed.scrollTop, clientHeight: feed.clientHeight }');
    // Captured at the sample, never as a side effect inside a setState
    // updater — React may run an updater eagerly, twice, or not at all.
    expect(room).toContain('if (next.hidden !== wasHidden) {');
    expect(room).not.toContain('setChromeHidden(prev => {');
    expect(room).toContain('chromeAnchoredTop(anchor.top, anchor.clientHeight, el.scrollHeight, el.clientHeight)');
    expect(room).not.toContain('anchoredScrollTop(');
  });

  it('never changes feed geometry from the at-bottom state', () => {
    expect(room).toContain('paddingBottom: 16');
    // Still never a function of atBottom — that caused the grow/shrink loop.
    expect(room).not.toContain('paddingBottom: (unseenCount > 0 || !atBottom');
  });
});
