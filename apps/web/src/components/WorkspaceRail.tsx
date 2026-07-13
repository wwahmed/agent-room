import { Link, useNavigate } from 'react-router-dom';

// T-05 desktop workspace rail (64px), Slack IA: brand mark up top, then
// Home and New-room. Desktop-only — mobile gets the full-width chat
// list on Home instead.

export function WorkspaceRail() {
  const navigate = useNavigate();
  return (
    <nav className="hidden h-full w-16 flex-shrink-0 flex-col items-center gap-3 border-r border-border-faint bg-surface-sunken py-3 lg:flex">
      <Link to="/" aria-label="WakiChat home" className="transition hover:opacity-85">
        <img src="/brand/wakichat/wakichat-icon-192.png" alt="" className="h-10 w-10" />
      </Link>
      <Link
        to="/"
        aria-label="All rooms"
        title="All rooms"
        className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft transition hover:bg-surface-softer hover:text-ink"
      >
        <svg viewBox="0 0 16 16" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 6.5 8 2.5l5.5 4v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
          <path d="M6.25 13.5V9.75h3.5v3.75" />
        </svg>
      </Link>
      <button
        onClick={() => navigate('/new')}
        aria-label="New room"
        title="New room"
        className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft transition hover:bg-accent-tint hover:text-accent"
      >
        <svg viewBox="0 0 16 16" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
          <path d="M8 3v10M3 8h10" />
        </svg>
      </button>
    </nav>
  );
}
