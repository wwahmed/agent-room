// T-137: a tiny event bus so any surface (account menu, update banner) can open
// the "What's new" panel without threading callbacks through the tree. The panel
// is mounted once at the app root and listens for this event.
export const WHATS_NEW_EVENT = 'wakichat:whats-new';

export function openWhatsNew(): void {
  try {
    window.dispatchEvent(new CustomEvent(WHATS_NEW_EVENT));
  } catch {
    /* non-browser context */
  }
}
