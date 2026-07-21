import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { fetchIdentity, type WhoAmI } from '../lib/identity.js';
import { colorForName, initialsFor } from '../lib/colors.js';
import { AppearanceChoices, ReadingScaleChoices } from '../components/PreferenceControls.js';

// T-26/T-27: the app-level Settings destination behind the Home account
// menu's Settings row. Room-scoped settings stay on the room's Settings
// workspace surface; this page owns only what belongs to the PERSON —
// identity, appearance, reading scale, sign out. The preference controls
// are the same components the account-menu subpanels render, so the two
// surfaces cannot drift.

function sectionHead(label: string) {
  return <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-faint">{label}</h2>;
}

export function Settings() {
  const navigate = useNavigate();
  const [identity, setIdentity] = useState<WhoAmI | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchIdentity().then(me => { if (!cancelled) setIdentity(me); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-surface-sunken text-ink">
      <header className="border-b border-border-subtle">
        <div className="mx-auto flex h-14 max-w-xl items-center gap-1 px-2 sm:px-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-ink-soft transition hover:bg-surface-softer hover:text-ink"
          >
            <svg viewBox="0 0 16 16" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.5 3 5.5 8l5 5" />
            </svg>
          </button>
          <h1 className="text-[17px] font-bold tracking-tight">Settings</h1>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-4 px-4 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-6">
        <section aria-label="Account" className="rounded-xl border border-border-faint bg-surface p-4">
          {sectionHead('Account')}
          {identity ? (
            <div className="flex items-center gap-3">
              <span
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: colorForName(identity.name) }}
                aria-hidden="true"
              >
                {initialsFor(identity.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold text-ink">{identity.name}</span>
                <span className="block truncate text-[13px] text-ink-faint">{identity.email}</span>
              </span>
            </div>
          ) : (
            <div className="text-sm text-ink-soft">
              Not signed in. <Link to="/" className="font-semibold text-accent">Back to Home</Link> to sign in.
            </div>
          )}
        </section>

        <section aria-label="Appearance" className="rounded-xl border border-border-faint bg-surface p-4">
          {sectionHead('Appearance')}
          <AppearanceChoices />
        </section>

        <section aria-label="Reading scale" className="rounded-xl border border-border-faint bg-surface p-4">
          {sectionHead('Reading scale')}
          <p className="mb-2 text-[13px] text-ink-soft">Message text size on phones. Comfortable is the default.</p>
          <ReadingScaleChoices />
        </section>

        {identity && (
          <section aria-label="Sign out" className="rounded-xl border border-red-400/30 bg-red-500/5 p-4">
            <a
              href="/cdn-cgi/access/logout"
              className="flex min-h-11 w-fit items-center gap-3 rounded-lg px-3 text-[15px] font-medium text-red-400 transition hover:bg-red-500/10"
            >
              <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 2.5H4.5A1 1 0 0 0 3.5 3.5v9a1 1 0 0 0 1 1H10" />
                <path d="M13.5 8H6.8M11 5.3 13.7 8 11 10.7" />
              </svg>
              Log out
            </a>
          </section>
        )}
      </main>
    </div>
  );
}
