import { createBrowserRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Home } from './screens/Home.js';
import { CreateMeeting } from './screens/CreateMeeting.js';
import { Lobby } from './screens/Lobby.js';
import { Room } from './screens/Room.js';
import { Join } from './screens/Join.js';
import { ToastHost } from './components/Toast.js';

function Layout({ children }: { children: ReactNode }) {
  return <><ToastHost />{children}</>;
}

export const router = createBrowserRouter([
  { path: '/', element: <Layout><Home /></Layout> },
  { path: '/new', element: <Layout><CreateMeeting /></Layout> },
  { path: '/r/:code/lobby', element: <Layout><Lobby /></Layout> },
  { path: '/r/:code', element: <Layout><Room /></Layout> },
  { path: '/j/:code', element: <Layout><Join /></Layout> },
  { path: '/j', element: <Layout><Join /></Layout> },
]);
