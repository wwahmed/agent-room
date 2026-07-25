// Phone back button: a DEEP ENTRY into the app — a push-notification tap
// (sw.js deep-links to /r/<code>), a /j/<code> invite link, or the PWA
// cold-starting on its last URL — creates a session whose history has exactly
// one entry. Hardware back then has nothing to pop, so the OS minimizes the
// app instead of going to the room list.
//
// The backstop runs once at app boot and slips a Home entry UNDERNEATH the
// entry route: replace the lone entry with '/', push the real URL back on
// top. The router never observes pushState/replaceState (only popstate), so
// the visible screen is untouched — but back now pops to Home exactly like an
// in-app entry. idx mirrors react-router's history-index bookkeeping, and
// seeding only ever fires at history index 0, so T-116's replace semantics in
// the creation flow (create → lobby → room) are unaffected.

export function needsBackstop(state: unknown, pathname: string): boolean {
  const idx = (state as { idx?: number } | null)?.idx ?? 0;
  return idx === 0 && pathname !== '/';
}

export function installHomeBackstop(): void {
  if (typeof window === 'undefined') return;
  if (!needsBackstop(window.history.state, window.location.pathname)) return;
  const here = window.location.pathname + window.location.search + window.location.hash;
  const st = (window.history.state ?? {}) as Record<string, unknown>;
  window.history.replaceState({ ...st, idx: 0, key: 'backstop-home' }, '', '/');
  window.history.pushState({ ...st, idx: 1 }, '', here);
}
