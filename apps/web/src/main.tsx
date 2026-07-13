import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router.js';
import './index.css';

// The open-source app runs fully anonymous: share the room code and
// anyone joins (self-host adds Access identity). Room creation, messaging, reports
// all work without a sign-in.
const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
