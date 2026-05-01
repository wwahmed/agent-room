import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import { router } from './router.js';
import { ENV } from './env.js';
import './index.css';

// Clerk is wrapped only when the publishable key is configured. The app
// otherwise runs fully anonymous — auth is only required at the payment
// moment (unlocking a polished delivery report), not for room creation
// or messaging. This keeps the "share the code, anyone joins" UX intact.
const root = ReactDOM.createRoot(document.getElementById('root')!);
const tree = <RouterProvider router={router} />;

root.render(
  <React.StrictMode>
    {ENV.clerkPublishableKey
      ? <ClerkProvider publishableKey={ENV.clerkPublishableKey}>{tree}</ClerkProvider>
      : tree}
  </React.StrictMode>
);
