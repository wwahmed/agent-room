import { useEffect, useState } from 'react';

// Self-host update banner (waki-shell convention). The server exposes the
// deployed bundle hash at /api/version; we remember the hash we booted
// with and poll for drift — every POLL_MS and whenever the tab regains
// focus (the common "pick the phone back up" moment). On drift, show a
// one-tap reload bar instead of making the user fight pull-to-refresh.

const POLL_MS = 44_000;

async function fetchBundle(): Promise<string | null> {
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
    let booted: string | null = null;
    let stopped = false;

    async function check() {
      if (stopped) return;
      const current = await fetchBundle();
      if (stopped || !current) return;
      if (booted === null) {
        booted = current;
        return;
      }
      if (current !== booted) setUpdateReady(true);
    }

    void check();
    const timer = window.setInterval(() => { void check(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!updateReady) return null;
  return (
    <button
      onClick={() => window.location.reload()}
      className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center gap-2 bg-accent px-4 py-3 text-sm font-semibold text-white shadow-lg"
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
    >
      A new version is ready — tap to update
    </button>
  );
}
