// T-118: client side of the owner notification channel. Registration is
// progressive enhancement — every capability is feature-detected, and the
// Settings card renders the LIVE permission state, never a stored belief.

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export function pushSupport(): { supported: boolean; permission: PushPermission } {
  const supported = typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
  return { supported, permission: supported ? (Notification.permission as PushPermission) : 'unsupported' };
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); } catch { return null; }
}

// The applicationServerKey wants the VAPID public key as bytes backed by a
// plain ArrayBuffer (TS 5.7 types reject ArrayBufferLike here).
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Ask permission, subscribe this device, and register it with the server. */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  const { supported } = pushSupport();
  if (!supported) return { ok: false, reason: 'This browser does not support notifications.' };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'Notifications are blocked for this app. Allow them in your browser settings.' };
  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, reason: 'Service worker registration failed.' };
  const keyResp = await fetch('/api/push/vapid-public-key');
  if (!keyResp.ok) return { ok: false, reason: 'The server has no push keys configured.' };
  const { publicKey } = (await keyResp.json()) as { publicKey: string };
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const save = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  if (!save.ok) return { ok: false, reason: 'The server rejected the device registration.' };
  return { ok: true };
}

export async function isSubscribed(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  return (await reg.pushManager.getSubscription()) !== null;
}

export async function sendTestPush(): Promise<{ ok: boolean; detail: string }> {
  const resp = await fetch('/api/push/test', { method: 'POST' });
  if (!resp.ok) return { ok: false, detail: `Server said ${resp.status}.` };
  const body = (await resp.json()) as { sent: number; pruned: number };
  if (body.sent === 0) return { ok: false, detail: 'No registered devices received it. Enable notifications first.' };
  return { ok: true, detail: `Delivered to ${body.sent} device${body.sent === 1 ? '' : 's'}.` };
}

// ---------- notify level (T-118 follow-up: "All messages" mode) ----------
// Per-account server-side preference: 'mentions' (default) pushes only
// @mentions and questions; 'all' also pushes every teammate message (the
// server suppresses those while you're actively reading the room).

export type NotifyLevel = 'mentions' | 'all';

export async function getNotifyLevel(): Promise<NotifyLevel> {
  try {
    const resp = await fetch('/api/push/prefs');
    if (!resp.ok) return 'mentions';
    const body = (await resp.json()) as { level?: unknown };
    return body.level === 'all' ? 'all' : 'mentions';
  } catch {
    return 'mentions';
  }
}

export async function setNotifyLevel(level: NotifyLevel): Promise<{ ok: boolean; reason?: string }> {
  const resp = await fetch('/api/push/prefs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level }),
  });
  if (!resp.ok) return { ok: false, reason: `The server rejected the preference (${resp.status}).` };
  return { ok: true };
}

/** Close every notification this app is showing in the system tray. Waqas:
 *  opening the app must clean the tray — the messages are on screen now, so
 *  a stale stack of "X sent a message" entries is just noise. */
export async function clearShownNotifications(): Promise<number> {
  if (!('serviceWorker' in navigator)) return 0;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return 0;
    const shown = await reg.getNotifications();
    for (const n of shown) n.close();
    return shown.length;
  } catch {
    return 0;
  }
}

/** The app icon badge AND the tray notifications clear whenever the app
 *  comes to the foreground (launch, tab focus, PWA resume). */
export function installBadgeClearing(): void {
  const clear = () => {
    if ('clearAppBadge' in navigator) void navigator.clearAppBadge().catch(() => undefined);
    void clearShownNotifications();
  };
  window.addEventListener('focus', clear);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') clear();
  });
  clear();
}
