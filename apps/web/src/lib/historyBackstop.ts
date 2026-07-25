// Phone back button: a DEEP ENTRY into a room — a push-notification tap
// (sw.js opens /r/<code> directly) or Android cold-starting the PWA on a room
// URL — creates a session whose history has exactly one entry. Hardware back
// then has nothing to pop, so the OS minimizes the app instead of going Home.
//
// The backstop slips a Home entry UNDERNEATH the room entry: replace the
// lone entry with '/', push the room URL back on top. The router never
// observes pushState/replaceState (only popstate), so the visible screen is
// untouched — but back now pops to Home like it does when the room was
// entered from Home. idx mirrors react-router's history-index bookkeeping.

export function needsBackstop(state: unknown, pathname: string): boolean {
  const idx = (state as { idx?: number } | null)?.idx ?? 0;
  return idx === 0 && pathname.startsWith('/r/');
}

export function installHomeBackstop(): void {
  if (typeof window === 'undefined') return;
  if (!needsBackstop(window.history.state, window.location.pathname)) return;
  const here = window.location.pathname + window.location.search + window.location.hash;
  const st = (window.history.state ?? {}) as Record<string, unknown>;
  window.history.replaceState({ ...st, idx: 0, key: 'backstop-home' }, '', '/');
  window.history.pushState({ ...st, idx: 1 }, '', here);
}
