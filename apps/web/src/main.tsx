import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router.js';
import { watchSystemTheme } from './lib/theme.js';
import { installBadgeClearing, registerServiceWorker } from './lib/push.js';
import { installReadMarkerSync, syncReadMarkers } from './lib/readSync.js';
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
// account, and pull the account's map at boot so Home badges reflect what
// was read on other devices.
installReadMarkerSync();
void syncReadMarkers();

// The open-source app runs fully anonymous: share the room code and
// anyone joins (self-host adds Access identity). Room creation, messaging, reports
// all work without a sign-in.
const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
