// Scroll-past-read (host order, reverts T-22's open-acknowledge): map a feed
// scroll position to the absolute read count it implies, so the marker
// advances only over messages the reader has actually scrolled past — never
// just because the room was opened. That is what lets the next visit land on
// the true first-unread divider again.
//
// `messages` is the loaded window (oldest → newest) whose rendered rows carry
// DOM ids `msg-<id>`; `messageTotal` is the server's absolute counter, so the
// window covers positions (messageTotal - messages.length, messageTotal]. A
// message counts as READ once its row sits fully above the viewport bottom.
// Rows that never rendered (reaction transport, zero-content envelopes,
// collapsed heartbeats) cannot be measured — the scan skips them, so the count
// stops at the nearest measurable row; the at-bottom path (which marks
// messageTotal) sweeps any hidden tail.
export function scrollReadCount(
  messages: ReadonlyArray<{ id?: number }>,
  messageTotal: number,
  viewBottom: number,
  rowBottom: (id: number) => number | null,
): number | null {
  const loadedStart = Math.max(0, messageTotal - messages.length);
  for (let i = messages.length - 1; i >= 0; i--) {
    const id = messages[i]?.id;
    if (id == null) continue; // T-113 id-less envelope — cannot be addressed
    const bottom = rowBottom(id);
    if (bottom === null) continue; // not rendered (filtered/collapsed row)
    if (bottom <= viewBottom) return loadedStart + i + 1;
  }
  return null; // nothing measurable is fully above the viewport bottom
}
