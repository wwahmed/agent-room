import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router.js';
import { watchSystemTheme } from './lib/theme.js';
import { installBadgeClearing, registerServiceWorker } from './lib/push.js';
import { installReadMarkerSync } from './lib/readSync.js';
import { installHomeBackstop } from './lib/historyBackstop.js';
import './index.css';

// T-26/T-27: while the stored theme setting is 'system' (the default), the
// app follows the device's light/dark switch LIVE, not just at load.
watchSystemTheme();

// T-118: notification channel plumbing — the service worker registers at
// boot (a no-op where unsupported), and the app icon badge clears whenever
// the app comes to the foreground.
void registerServiceWorker();
installBadgeClearing();
// T-126: READ-STATE IS USER-STATE — push local marker advances to the
// account. Home pulls the full account map; Room pulls only its own marker.
// A route-agnostic boot pull would mutate unrelated B/C markers when a cold
// start opens room A directly.
installReadMarkerSync();
// Phone back button: a cold start that lands anywhere but Home (notification
// tap, invite link, PWA URL restore) has no history to pop, so hardware back
// minimizes the app. Seed a Home entry underneath the entry route.
installHomeBackstop();

// The open-source app runs fully anonymous: share the room code and
// anyone joins (self-host adds Access identity). Room creation, messaging, reports
// all work without a sign-in.
const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
