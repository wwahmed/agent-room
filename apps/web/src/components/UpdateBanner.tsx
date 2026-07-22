import { useEffect, useState } from 'react';

// Self-host update banner (waki-shell convention). The server exposes the
// deployed bundle hash at /api/version; the client knows its OWN hash from
// the entry <script> tag that loaded it. Any check where the two differ
// shows a one-tap reload bar instead of making the user fight
// pull-to-refresh.
//
// T-106: the previous version learned "what am I running" by remembering
// the FIRST /api/version answer. A phone restoring the app from memory
// mounts this component fresh, so that first answer is the server's NEW
// hash while the page is still running OLD code — the comparison is
// new-vs-new forever and the prompt can never fire. Reading our own hash
// from the DOM makes the comparison stateless and restore-proof.

const POLL_MS = 44_000;

// The bundle id of the code actually running in this page, from the hashed
// entry script Vite emitted (e.g. /assets/index-6GDwdEzP.js). null on the
// dev server (unhashed /src/main.tsx), where updates don't apply.
export function ownBundle(doc: Document = document): string | null {
  for (const s of Array.from(doc.querySelectorAll('script[src]'))) {
    const m = (s.getAttribute('src') || '').match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
    if (m?.[1]) return m[1];
  }
  return null;
}

async function serverBundle(): Promise<string | null> {
  try {
    const resp = await fetch('/api/version', { cache: 'no-store' });
    if (!resp.ok) return null;
    const body = (await resp.json()) as { bundle?: string };
    return body.bundle && body.bundle !== 'unknown' ? body.bundle : null;
  } catch {
    return null;
  }
}

export function UpdateBanner() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    const running = ownBundle();
    if (!running) return; // dev server: nothing to compare against
    let stopped = false;

    async function check() {
      if (stopped) return;
      const current = await serverBundle();
      if (stopped || !current) return;
      if (current !== running) setUpdateReady(true);
    }

    void check();
    const timer = window.setInterval(() => { void check(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    // pageshow is the only event guaranteed on a back/forward-cache restore;
    // visibilitychange covers the ordinary background→foreground resume.
    const onPageShow = () => { void check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  if (!updateReady) return null;
  return (
    <button
      onClick={() => {
        // Revalidate the cached document first so the reload cannot hand
        // back the same stale index.html, then reload. Best-effort: if the
        // fetch fails (offline blip) the plain reload still runs.
        void fetch('/', { cache: 'reload' }).catch(() => undefined).then(() => window.location.reload());
      }}
      role="status"
      // T-42 (Waqas): pinned to the TOP so it never overlaps the composer /
      // bottom controls; top safe-area inset keeps it clear of the notch.
      // T-46: one 250ms ease-out drop-in, reduced-motion guarded.
      className="banner-enter fixed inset-x-0 top-0 z-[100] flex min-h-11 items-center justify-center gap-2 bg-accent px-4 py-3 text-sm font-semibold text-white shadow-lg"
      style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
    >
      A new version is ready — tap to reload
    </button>
  );
}
