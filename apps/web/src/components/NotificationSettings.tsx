import { useEffect, useState } from 'react';
import { enablePush, isSubscribed, pushSupport, sendTestPush, type PushPermission } from '../lib/push.js';

// T-118 (host order): the TOP of Settings states plainly whether phone
// notifications are enabled or blocked — the LIVE browser permission, never
// a stored preference — with a one-tap enable path and a test button that
// proves the pipe end to end.

const STATE_COPY: Record<PushPermission, { label: string; tone: string; detail: string }> = {
  granted: { label: 'Enabled', tone: 'text-emerald-500', detail: 'This device can receive notifications.' },
  denied: { label: 'Blocked', tone: 'text-red-500', detail: 'Notifications are blocked in your browser or system settings for this app. Allow them there, then return here.' },
  default: { label: 'Not set up', tone: 'text-amber-500', detail: 'Mentions and questions will not reach this device until you enable notifications.' },
  unsupported: { label: 'Unavailable', tone: 'text-ink-faint', detail: 'This browser does not support push notifications.' },
};

export function NotificationSettings() {
  const [permission, setPermission] = useState<PushPermission>(() => pushSupport().permission);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void isSubscribed().then(v => { if (!cancelled) setRegistered(v); });
    // Live truth: re-read the permission whenever the page regains focus —
    // the user may have flipped it in system settings.
    const refresh = () => setPermission(pushSupport().permission);
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, []);

  const enabled = permission === 'granted' && registered === true;
  // Truthful state: browser permission granted but device not registered
  // with the server is NOT enabled — the server cannot reach this device.
  const state = permission === 'granted' && registered === false
    ? { label: 'Not registered', tone: 'text-amber-500', detail: 'Notifications are allowed, but this device is not registered with the server yet.' }
    : STATE_COPY[permission];

  async function onEnable() {
    setBusy(true);
    setFeedback(null);
    try {
      const outcome = await enablePush();
      setPermission(pushSupport().permission);
      if (outcome.ok) { setRegistered(true); setFeedback('This device is registered. Send a test to confirm.'); }
      else setFeedback(outcome.reason ?? 'Could not enable notifications.');
    } finally { setBusy(false); }
  }

  async function onTest() {
    setBusy(true);
    setFeedback(null);
    try {
      const outcome = await sendTestPush();
      setFeedback(outcome.detail);
    } finally { setBusy(false); }
  }

  return (
    <section aria-label="Notifications" className="rounded-xl border border-border-faint bg-surface p-4" data-gate="notification-settings">
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-faint">Notifications</h2>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">
            Phone notifications: <span className={state.tone} data-gate="notification-state">{enabled ? 'Enabled' : state.label}</span>
          </p>
          <p className="mt-0.5 text-[13px] text-ink-soft">{enabled ? 'Mentions and questions reach this device.' : state.detail}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {permission !== 'denied' && permission !== 'unsupported' && !enabled && (
          <button
            type="button"
            disabled={busy}
            onClick={() => { void onEnable(); }}
            className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Enable on this device
          </button>
        )}
        {permission === 'granted' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => { void onTest(); }}
            className="min-h-11 rounded-lg border border-border bg-surface-softer px-4 text-sm font-semibold transition hover:border-accent disabled:opacity-50"
          >
            Send test notification
          </button>
        )}
      </div>
      {feedback && <p role="status" className="mt-2 text-[13px] text-ink-soft">{feedback}</p>}
    </section>
  );
}
