import { useEffect, useState } from 'react';

// T-44: surface the deployed build id so "what build am I on?" is answerable
// in-product. Same /api/version the update banner polls. Unobtrusive: a muted
// mono line; renders nothing when the server can't name a build (dev / offline).
export function VersionTag({ className }: { className?: string }) {
  const [version, setVersion] = useState<{ bundle: string; release: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/version', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { bundle?: string; release?: string } | null) => {
        if (!cancelled && b?.bundle && b.bundle !== 'unknown') {
          setVersion({ bundle: b.bundle, release: b.release || b.bundle });
        }
      })
      .catch(() => {
        /* offline or dev server without /api/version: show nothing */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!version) return null;
  const short = version.release.length > 12 ? version.release.slice(0, 12) : version.release;
  return (
    <span
      className={className ?? 'font-mono text-[12px] tabular-nums text-ink-faint'}
      title={`Immutable release ${version.release} · web bundle ${version.bundle}`}
    >
      release {short}
    </span>
  );
}
