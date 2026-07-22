// T-118: WakiChat service worker — owner notification channel.
// Push events show a real notification and keep the app icon badge equal to
// the number of open notifications; tapping a notification focuses (or
// opens) the room the event came from.

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

async function syncBadge() {
  if (!('setAppBadge' in self.registration ? false : 'setAppBadge' in navigator)) {
    if (!('setAppBadge' in navigator)) return;
  }
  try {
    const open = await self.registration.getNotifications();
    if (open.length > 0) await navigator.setAppBadge(open.length);
    else await navigator.clearAppBadge();
  } catch { /* badging is progressive enhancement */ }
}

self.addEventListener('push', (event) => {
  let payload = { title: 'WakiChat', body: '', url: '/', tag: undefined };
  try { payload = { ...payload, ...event.data.json() }; } catch { /* keep defaults */ }
  event.waitUntil((async () => {
    await self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: '/brand/wakichat/wakichat-icon-192.png',
      badge: '/brand/wakichat/wakichat-icon-192.png',
      data: { url: payload.url },
    });
    await syncBadge();
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = wins.find(w => w.url.includes(url)) || wins[0];
    if (existing) {
      await existing.focus();
      if (!existing.url.includes(url) && 'navigate' in existing) await existing.navigate(url);
    } else {
      await self.clients.openWindow(url);
    }
    await syncBadge();
  })());
});
