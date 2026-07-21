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

/** Within this distance of the history top, chrome is always shown. */
export const TOP_REVEAL = 8;

export function initialChromeVis(top = 0): ChromeVis {
  return { hidden: false, accum: 0, lastTop: top };
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
  // Reversals restart the accumulator: intent is measured per direction.
  // A fresh accumulator (0) continues with either direction.
  const accum = v.accum === 0 || delta > 0 === v.accum > 0 ? v.accum + delta : delta;
  let hidden = v.hidden;
  if (accum > CHROME_HYSTERESIS) hidden = true; // reading deeper
  else if (accum < -CHROME_HYSTERESIS) hidden = false; // deliberate reverse
  return { hidden, accum, lastTop: top };
}
