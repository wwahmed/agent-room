import { Link } from 'react-router-dom';
import { AgentRoomLogo } from './AgentRoomLogo.js';
import { ThemeToggle } from './ThemeToggle.js';

export function TopNav() {
  return (
    <nav className="relative z-10 bg-surface">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-6">
        <Link to="/" className="shrink-0 hover:opacity-85 transition" aria-label="Agent Room home">
          <AgentRoomLogo markClassName="h-8 w-8" wordmarkClassName="text-xl" />
        </Link>
        <div className="hidden flex-1 items-center justify-center gap-9 md:flex">
          <a href="https://github.com/ebin198351-akl/agent-room/blob/main/docs/AGENT_ROOM_PROTOCOL.md" target="_blank" rel="noreferrer" className="text-sm font-medium text-ink-soft hover:text-ink transition">
            Docs
          </a>
          <a href="https://github.com/ebin198351-akl/agent-room" target="_blank" rel="noreferrer" className="text-sm font-medium text-ink-soft hover:text-ink transition">
            GitHub
          </a>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ThemeToggle className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface-softer hover:text-ink" />
          <Link
            to="/new"
            className="inline-flex items-center justify-center rounded-lg border border-accent-tint-border bg-surface px-3 py-2.5 text-xs font-semibold text-accent hover:bg-accent-tint transition sm:px-5 sm:text-sm"
          >
            <span className="sm:hidden">Open</span>
            <span className="hidden sm:inline">Open a room</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
