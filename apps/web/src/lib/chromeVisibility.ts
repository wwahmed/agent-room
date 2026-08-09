export interface ChromeVis {
  hidden: boolean;
  accum: number;
  lastTop: number;
}

/** Ignore touch noise and require a deliberate same-direction gesture. */
export const CHROME_HYSTERESIS = 24;
/** Programmatic landings and seeks are not reading gestures. */
export const JUMP_RESET = 300;
/** The top of history always exposes the room controls. */
export const TOP_REVEAL = 8;

export function initialChromeVis(top = 0): ChromeVis {
  return { hidden: false, accum: 0, lastTop: top };
}

/**
 * Pure visibility reducer for floating phone chrome. This state must never be
 * used to change feed layout; it controls compositor transforms only.
 */
export function chromeStep(v: ChromeVis, top: number, pinned: boolean, atBottom: boolean): ChromeVis {
  if (pinned || atBottom || top <= TOP_REVEAL) {
    return { hidden: false, accum: 0, lastTop: top };
  }
  const delta = top - v.lastTop;
  if (delta === 0) return v;
  if (Math.abs(delta) > JUMP_RESET) return { hidden: v.hidden, accum: 0, lastTop: top };
  const accum = v.accum === 0 || delta > 0 === v.accum > 0 ? v.accum + delta : delta;
  let hidden = v.hidden;
  if (accum > CHROME_HYSTERESIS) hidden = true;
  else if (accum < -CHROME_HYSTERESIS) hidden = false;
  return { hidden, accum, lastTop: top };
}
