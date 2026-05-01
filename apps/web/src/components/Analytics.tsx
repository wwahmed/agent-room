import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// SPA route-change tracker for Google Analytics 4.
//
// Why this exists: index.html loads gtag with send_page_view:false. That
// means the GA4 script is on the page but it does NOT auto-send the
// initial page_view event. We send it ourselves here, on every route
// change (including the first mount), so /r/CODE, /j/CODE, /new etc.
// all get logged as distinct page_view hits — not just whatever URL
// the visitor first landed on.
//
// We also strip room-specific paths down to a stable shape
// (`/r/<code>` → `/r/:code`) so GA4 reports group all rooms together
// instead of producing one row per random 9-character code. The full
// URL still goes through as page_location for analytics that want it,
// but page_path stays clean.

interface GtagFn {
  (command: 'event', name: string, params?: Record<string, unknown>): void;
  (command: 'config', id: string, params?: Record<string, unknown>): void;
  (command: 'js', date: Date): void;
}

declare global {
  interface Window {
    gtag?: GtagFn;
    dataLayer?: unknown[];
  }
}

function normalizePath(pathname: string): string {
  // Collapse 9-char room codes (e.g. ABC-DEF-GHJ) to ":code" so GA4
  // doesn't fragment the report into thousands of one-hit rows.
  return pathname
    .replace(/^\/r\/[A-Z0-9-]{9,}/, '/r/:code')
    .replace(/^\/j\/[A-Z0-9-]{9,}/, '/j/:code');
}

export function Analytics() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (typeof window.gtag !== 'function') return;
    const page_path = normalizePath(pathname) + search;
    window.gtag('event', 'page_view', {
      page_path,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname, search]);

  return null;
}
