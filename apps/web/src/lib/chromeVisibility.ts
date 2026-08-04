// T-82: contextual phone chrome. Pure direction/hysteresis reducer for the
// reading-mode chrome (command bar + tabs above, idle composer below). The
// feed's scroll handler drives it through one rAF; the component maps
// `hidden` onto transform classes. Kept free of DOM so the state machine is
// unit-testable, including the pinning matrix.

export interface ChromeVis {
  /** true = chrome translated out of the viewport (immersive reading). */
  hidden: boolean;
  /** Accumulated same-direction scroll distance; resets on reversal. */
  accum: number;
  lastTop: number;
}

/** Deliberate-gesture threshold: touch noise below this never flips chrome. */
export const CHROME_HYSTERESIS = 24;

/** Per-sample deltas beyond this are TELEPORTS (first-unread landing, jump
 *  to latest, mention seeks), not finger gestures — they reset the
 *  accumulator without flipping visibility. A real swipe never moves this
 *  far between two rAF samples. */
export const JUMP_RESET = 300;

/** Within this distance of the history top, chrome is always shown. */
export const TOP_REVEAL = 8;

export function initialChromeVis(top = 0): ChromeVis {
  return { hidden: false, accum: 0, lastTop: top };
}

/**
 * Where the feed must be scrolled to after a chrome toggle, so that the text
 * under the reader's eyes does not move.
 *
 * What actually moves the reader is the feed's own top edge. The feed is the
 * flex child that absorbs the column's spare height, so when a clearance row
 * above it unmounts, the feed grows by that much AND starts that much higher.
 * Content drawn at a given scroll offset therefore rides up the screen by the
 * clientHeight delta, and the compensation is to scroll back down by it.
 *
 * Deliberately expressed as a delta rather than as a preserved distance from
 * the tail. The two agree only while `scrollHeight` is constant; the tail form
 * silently folds any scrollHeight change into the reader's position, which is
 * how a collapsing bottom padding turned into a composer-sized jump. This form
 * ignores scrollHeight except to clamp, so it stays correct either way.
 *
 * Measured on the live phone layout: hiding the chrome grows the feed 708 ->
 * 812, and the tracked message moves 104px up the screen with no compensation.
 */
export function chromeAnchoredTop(
  previousTop: number,
  previousClientHeight: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const grewBy = clientHeight - previousClientHeight;
  const maxTop = Math.max(0, scrollHeight - clientHeight);
  return Math.min(Math.max(0, previousTop - grewBy), maxTop);
}

/**
 * One scroll sample. `pinned` is the union of every state that must never
 * lose chrome: nonempty draft, composer focus/keyboard, reply, uploads,
 * recording, error, attachment dialog. `atBottom` restores chrome at the
 * newest message (the reader has arrived; the composer is the next action).
 */
export function chromeStep(v: ChromeVis, top: number, pinned: boolean, atBottom: boolean): ChromeVis {
  if (pinned || atBottom || top <= TOP_REVEAL) {
    return { hidden: false, accum: 0, lastTop: top };
  }
  const delta = top - v.lastTop;
  if (delta === 0) return v;
  // Programmatic teleports are not reading gestures (gate caught the
  // first-unread landing hiding chrome at load).
  if (Math.abs(delta) > JUMP_RESET) return { hidden: v.hidden, accum: 0, lastTop: top };
  // Reversals restart the accumulator: intent is measured per direction.
  // A fresh accumulator (0) continues with either direction.
  const accum = v.accum === 0 || delta > 0 === v.accum > 0 ? v.accum + delta : delta;
  let hidden = v.hidden;
  if (accum > CHROME_HYSTERESIS) hidden = true; // reading deeper
  else if (accum < -CHROME_HYSTERESIS) hidden = false; // deliberate reverse
  return { hidden, accum, lastTop: top };
}
