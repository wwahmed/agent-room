// T-112 READING-ANCHOR RULE (host order): any in-place expansion or
// contraction keeps the element the user touched at the same viewport
// position — content grows or shrinks below the reading point, and the page
// never scrolls as a side effect.
//
// Two cooperating pieces:
//  - components that mutate layout call `markAnchoredMutation()` at the
//    moment of the user gesture, then compensate their scroll parent so the
//    tapped control stays put;
//  - the feed's stay-pinned-at-bottom observer (T-72) checks
//    `withinAnchoredMutation()` and yields, because re-pinning to bottom
//    after an expansion is exactly the "screen moves and I lose my place"
//    the rule forbids.

let lastAnchoredMutationAt = 0;

/** Call synchronously inside the user gesture that will mutate layout. */
export function markAnchoredMutation(now: number = Date.now()): void {
  lastAnchoredMutationAt = now;
}

/**
 * True while an anchored mutation is settling. The window is generous enough
 * to cover the commit + resize-observer turn but short enough that live
 * message traffic re-pins normally.
 */
export function withinAnchoredMutation(now: number = Date.now(), windowMs = 600): boolean {
  return now - lastAnchoredMutationAt < windowMs;
}

/** Nearest scrollable ancestor — the element whose scrollTop we compensate. */
export function getScrollParent(el: Element | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}
