import { useEffect, useState } from 'react';

// "Install as app" affordance, shown on Home only (never inside a room).
//
// Android / desktop Chrome: capture the beforeinstallprompt event and
// offer a real Install button that triggers the native dialog.
// iOS Safari: there is no programmatic install API, so when we detect
// iOS outside standalone mode we show the Add to Home Screen steps.
// Already-installed (display-mode: standalone) hides everything.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'agentroom:installDismissed';

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (isStandalone()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    if (isIos()) setShowIosGuide(true);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
  }

  if (dismissed || isStandalone() || (!deferred && !showIosGuide)) return null;

  return (
    <div className="mt-4 flex items-start gap-3 rounded-xl border border-border-faint bg-surface-softer p-4">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent">📱</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">Install Waki Chat as an app</div>
        {deferred ? (
          <div className="mt-1 text-xs text-ink-soft">Full screen, home-screen icon, no browser chrome.</div>
        ) : (
          <div className="mt-1 text-xs leading-relaxed text-ink-soft">
            In Safari: tap the <span className="font-semibold text-ink">Share</span> button, then{' '}
            <span className="font-semibold text-ink">Add to Home Screen</span>.
          </div>
        )}
        {deferred && (
          <button
            onClick={() => {
              void deferred.prompt();
              void deferred.userChoice.finally(() => setDeferred(null));
            }}
            className="mt-2 rounded-lg bg-accent px-4 py-2 min-h-11 text-sm font-semibold text-surface-sunken transition hover:opacity-90"
          >
            Install
          </button>
        )}
      </div>
      <button onClick={dismiss} aria-label="Dismiss" className="flex-shrink-0 p-1 text-ink-faint transition hover:text-ink">✕</button>
    </div>
  );
}
