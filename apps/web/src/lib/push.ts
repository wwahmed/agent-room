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

// The applicationServerKey wants the VAPID public key as a Uint8Array.
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
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

/** The app icon badge clears whenever the app comes to the foreground. */
export function installBadgeClearing(): void {
  if (!('clearAppBadge' in navigator)) return;
  const clear = () => { void navigator.clearAppBadge().catch(() => undefined); };
  window.addEventListener('focus', clear);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') clear();
  });
  clear();
}
