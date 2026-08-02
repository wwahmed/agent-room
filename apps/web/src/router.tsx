import { createBrowserRouter, useParams } from 'react-router-dom';
import { Suspense, lazy, type ReactNode } from 'react';
import { Home } from './screens/Home.js';
import { ToastHost } from './components/Toast.js';
import { Analytics } from './components/Analytics.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import { WhatsNew } from './components/WhatsNew.js';

// Launch cost. The app shipped as ONE chunk — 650 kB raw / 190 kB gzipped —
// so opening the app downloaded, parsed, and executed the room screen (4k+
// lines and everything it pulls in: the composer, voice, attachments, the
// board, the inspector) before Home could paint a single row. That is the
// host's "launching the app takes a long time; this should be near instant".
//
// Home stays STATIC — it is the launch screen and the back destination, and
// putting it behind a lazy boundary would trade one blank frame for another.
// Every other route is split out and fetched when it is actually navigated to.
// Opening a room is a deliberate act that already shows a route transition;
// launching the app is not.
const Settings = lazy(() => import('./screens/Settings.js').then(m => ({ default: m.Settings })));
const CreateMeeting = lazy(() => import('./screens/CreateMeeting.js').then(m => ({ default: m.CreateMeeting })));
const Lobby = lazy(() => import('./screens/Lobby.js').then(m => ({ default: m.Lobby })));
const Room = lazy(() => import('./screens/Room.js').then(m => ({ default: m.Room })));
const Report = lazy(() => import('./screens/Report.js').then(m => ({ default: m.Report })));
const Join = lazy(() => import('./screens/Join.js').then(m => ({ default: m.Join })));

// Shown only while a route chunk is in flight. It must never be mistaken for
// an empty room: no "no messages" wording, no false zeros — just the app frame
// holding its place.
function RouteFallback() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-screen items-center justify-center bg-surface-sunken">
      <span className="sr-only">Loading…</span>
      <span
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-[3px] border-accent/20 border-t-accent motion-reduce:animate-none"
      />
    </div>
  );
}

function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <ToastHost />
      <Analytics />
      <UpdateBanner />
      <WhatsNew />
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </>
  );
}

// Wrappers force a full remount whenever :code changes. Without this
// React reuses the same component instance across param changes, which
// kept stale `useRoom` polling state alive when a host transitioned
// through room_end → room_create in the same tab — the symptom Robin
// hit where new agents' messages didn't appear until a hard refresh.
function RoomByParam() {
  const { code = '' } = useParams();
  return <Room key={code} />;
}
function LobbyByParam() {
  const { code = '' } = useParams();
  return <Lobby key={code} />;
}
function ReportByParam() {
  const { code = '' } = useParams();
  return <Report key={code} />;
}

export const router = createBrowserRouter([
  { path: '/', element: <Layout><Home /></Layout> },
  { path: '/settings', element: <Layout><Settings /></Layout> },
  { path: '/new', element: <Layout><CreateMeeting /></Layout> },
  { path: '/r/:code/lobby', element: <Layout><LobbyByParam /></Layout> },
  { path: '/r/:code', element: <Layout><RoomByParam /></Layout> },
  { path: '/r/:code/report', element: <Layout><ReportByParam /></Layout> },
  { path: '/j/:code', element: <Layout><Join /></Layout> },
  { path: '/j', element: <Layout><Join /></Layout> },
]);
