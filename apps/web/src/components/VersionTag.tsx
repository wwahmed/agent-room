import { useEffect, useState } from 'react';

// T-44: surface the deployed build id so "what build am I on?" is answerable
// in-product. Same /api/version the update banner polls. Unobtrusive: a muted
// mono line; renders nothing when the server can't name a build (dev / offline).
export function VersionTag({ className }: { className?: string }) {
  const [bundle, setBundle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/version', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { bundle?: string } | null) => {
        if (!cancelled && b?.bundle && b.bundle !== 'unknown') setBundle(b.bundle);
      })
      .catch(() => {
        /* offline or dev server without /api/version: show nothing */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!bundle) return null;
  const short = bundle.length > 12 ? bundle.slice(0, 12) : bundle;
  return (
    <span
      className={className ?? 'font-mono text-[10px] tabular-nums text-ink-faint'}
      title={`Build ${bundle}`}
    >
      build {short}
    </span>
  );
}
