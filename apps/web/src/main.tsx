import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router.js';
import { watchSystemTheme } from './lib/theme.js';
import './index.css';

// T-26/T-27: while the stored theme setting is 'system' (the default), the
// app follows the device's light/dark switch LIVE, not just at load.
watchSystemTheme();

// The open-source app runs fully anonymous: share the room code and
// anyone joins (self-host adds Access identity). Room creation, messaging, reports
// all work without a sign-in.
const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
