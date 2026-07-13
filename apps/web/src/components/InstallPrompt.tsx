import { useEffect, useState } from 'react';

// "Install as app" affordance, shown on Home only (never inside a room).
//
// Android / desktop Chrome: capture the beforeinstallprompt event and
// offer a real Install button that triggers the native dialog.
// iOS Safari: there is no programmatic install API, so when we detect
// iOS outside standalone mode we show the Add to Home Screen steps.
// Browsers without a programmatic prompt still get a durable install entry
// with the correct manual instructions. Already-installed standalone mode
// hides the card.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

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
  const [installed, setInstalled] = useState(() => isStandalone());
  const [showGuide, setShowGuide] = useState(false);
  const ios = isIos();

  useEffect(() => {
    if (installed) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [installed]);

  if (installed) return null;

  const guide = ios
    ? <>In Safari, tap <span className="font-semibold text-ink">Share</span>, then <span className="font-semibold text-ink">Add to Home Screen</span>.</>
    : <>Open your browser menu and choose <span className="font-semibold text-ink">Install WakiChat</span> or <span className="font-semibold text-ink">Add to Home Screen</span>.</>;

  return (
    <div className="mt-4 flex items-start gap-3 rounded-xl border border-border-faint bg-surface-softer p-4">
      <img
        src="/brand/wakichat/wakichat-icon-192.png"
        alt=""
        className="h-10 w-10 flex-shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">Install WakiChat</div>
        <div className="mt-1 text-xs text-ink-soft">Full screen, home-screen icon, no browser chrome.</div>
        {showGuide && !deferred && (
          <div className="mt-1 text-xs leading-relaxed text-ink-soft">
            {guide}
          </div>
        )}
        <button
          onClick={() => {
            if (deferred) {
              void deferred.prompt();
              void deferred.userChoice.finally(() => setDeferred(null));
            } else {
              setShowGuide(value => !value);
            }
          }}
          className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
        >
          {deferred ? 'Install' : showGuide ? 'Hide instructions' : 'Install'}
        </button>
      </div>
    </div>
  );
}
