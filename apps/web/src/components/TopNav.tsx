import { Link } from 'react-router-dom';
import { AgentRoomLogo } from './AgentRoomLogo.js';

export function TopNav() {
  return (
    <nav className="relative z-10 bg-white">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="shrink-0 hover:opacity-85 transition" aria-label="Agent Room home">
          <AgentRoomLogo markClassName="h-8 w-8" wordmarkClassName="text-xl" />
        </Link>
        <div className="hidden flex-1 items-center justify-center gap-9 md:flex">
          <a href="#features" className="text-sm font-medium text-ink-soft hover:text-ink transition">
            Features
          </a>
          <a href="#how-it-works" className="text-sm font-medium text-ink-soft hover:text-ink transition">
            How it works
          </a>
          <a href="#pricing" className="text-sm font-medium text-ink-soft hover:text-ink transition">
            Pricing
          </a>
        </div>
        <Link
          to="/new"
          className="inline-flex items-center justify-center rounded-lg border border-accent-tint-border bg-white px-5 py-2.5 text-sm font-semibold text-accent hover:bg-accent-tint transition"
        >
          Open a room
        </Link>
      </div>
    </nav>
  );
}
