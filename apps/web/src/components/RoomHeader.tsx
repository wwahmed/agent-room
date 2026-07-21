import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Room } from '@agent-room/shared';
import type { AgentFace } from '../lib/facepile.js';
import { AgentFacepile } from './AgentFacepile.js';
import { ThemeToggle } from './ThemeToggle.js';

// T-58 north star: one 56px app-wide command bar with three jobs.
// Left says WHERE, center says FIND, right says WHO / WHAT NOW.
// Mobile compresses the same hierarchy to 52px without inventing a second UI.

interface Props {
  room: Room;
  ended: boolean;
  listeningCount: number;
  inspectorOpen: boolean;
  onShare: () => void;
  onToggleInspector: () => void;
  onSearch: () => void;
  onOpenRoom: () => void;
  onEndRoom: () => void;
  canEndRoom: boolean;
  agents: AgentFace[];
  agentStaleCount: number;
  mentionNav?: React.ReactNode;
}

export function RoomHeader({
  room,
  ended,
  listeningCount,
  inspectorOpen,
  onShare,
  onToggleInspector,
  onSearch,
  onOpenRoom,
  onEndRoom,
  canEndRoom,
  agents,
  agentStaleCount,
  mentionNav,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const agentCount = agents.length;
  const presence = ended
    ? 'Meeting ended'
    : `${room.participants.length} here${listeningCount > 0 ? ` · ${listeningCount} listening` : ''}`;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);

  return (
    <header className="app-command-bar fixed inset-x-0 top-0 z-40 flex h-[52px] items-center border-b border-border-subtle sm:h-14">
      <div className="flex h-full min-w-0 flex-1 items-center px-1.5 sm:px-3">
        <div className="flex min-w-0 items-center">
          <Link
            to="/"
            aria-label="Back to rooms"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-ink-soft transition hover:bg-surface-softer hover:text-ink"
          >
            <svg viewBox="0 0 16 16" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.5 3 5.5 8l5 5" />
            </svg>
          </Link>
          <Link
            to="/"
            aria-label="WakiChat home"
            className="mr-1 hidden h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl transition hover:bg-surface-softer sm:flex"
          >
            <img src="/brand/wakichat/wakichat-icon-192.png" alt="" className="h-7 w-7 rounded-lg shadow-[0_4px_16px_rgb(var(--accent)/0.24)]" />
          </Link>
          <button
            type="button"
            onClick={onOpenRoom}
            className="group min-h-11 min-w-0 rounded-xl px-1.5 py-1 text-left transition hover:bg-surface-softer sm:flex sm:items-center sm:gap-2"
            aria-label={`Open room settings for ${room.topic}`}
          >
            <span className="block max-w-[42vw] truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink sm:max-w-[220px] lg:max-w-[240px] xl:max-w-[300px]">
              {room.topic}
            </span>
            <span className={`mt-0.5 block truncate text-[12px] leading-tight sm:mt-0 ${ended ? 'font-medium text-red-400' : 'text-ink-faint'}`}>
              {!ended && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" aria-hidden="true" />}
              {presence}
            </span>
            <svg className="hidden flex-shrink-0 text-ink-faint opacity-0 transition group-hover:opacity-100 lg:block" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <path d="m3 11.8.4-2.3L10.8 2l2.2 2.2-7.5 7.5-2.5.1Z" />
            </svg>
          </button>
        </div>

        <button
          type="button"
          onClick={onSearch}
          aria-label="Search rooms, messages, and tasks"
          className="group absolute left-1/2 hidden h-11 w-[min(320px,28vw)] -translate-x-1/2 items-center text-[13px] text-ink-faint transition hover:text-ink-soft md:flex"
        >
          <span className="flex h-8 w-full items-center rounded-[9px] border border-border-faint bg-surface-sunken/70 px-3 shadow-inner transition group-hover:border-border">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3 3" />
            </svg>
            <span className="ml-2 truncate">Search rooms, messages, tasks…</span>
            <kbd className="ml-auto rounded-md border border-border-faint bg-surface px-1.5 py-0.5 text-[12px] font-medium text-ink-soft">⌘K</kbd>
          </span>
        </button>

        <div className="ml-auto flex flex-shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search rooms, messages, and tasks"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft transition hover:bg-surface-softer hover:text-ink md:hidden"
          >
            <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3 3" />
            </svg>
          </button>
          <div className="hidden sm:block">{mentionNav}</div>
          {agentCount > 0 && (
            <AgentFacepile code={room.code} agentCount={agentCount} agentStaleCount={agentStaleCount} agents={agents} />
          )}
          <button
            type="button"
            onClick={onShare}
            aria-label="Copy invite link"
            title="Copy invite link"
            className="hidden h-11 w-11 items-center justify-center rounded-xl text-ink-soft transition hover:bg-surface-softer hover:text-ink sm:flex"
          >
            <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.5 2.5h3v3M13.5 2.5 8.2 7.8" /><path d="M12.5 8.5v4a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h4" />
            </svg>
          </button>
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(open => !open)}
              aria-label="More room actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={`flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft transition hover:bg-surface-softer hover:text-ink ${menuOpen ? 'bg-surface-softer text-ink' : ''}`}
            >
              <svg viewBox="0 0 16 16" width="19" height="19" fill="currentColor" aria-hidden="true">
                <circle cx="3" cy="8" r="1.15" /><circle cx="8" cy="8" r="1.15" /><circle cx="13" cy="8" r="1.15" />
              </svg>
            </button>
            {menuOpen && (
              <div role="menu" aria-label="Room actions" className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-2xl">
                <ThemeToggle showLabel className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium text-ink-soft transition hover:bg-surface-softer hover:text-ink" />
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpenRoom(); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium text-ink-soft transition hover:bg-surface-softer hover:text-ink">
                  <span className="flex w-5 justify-center" aria-hidden="true">⚙</span>
                  Room settings & rename
                </button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onShare(); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium text-ink-soft transition hover:bg-surface-softer hover:text-ink sm:hidden">
                  <span className="flex w-5 justify-center" aria-hidden="true">↗</span>
                  Copy invite link
                </button>
                {canEndRoom && (
                  <>
                    <div className="my-1 h-px bg-border-faint" />
                    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEndRoom(); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium text-red-400 transition hover:bg-red-500/10">
                      <span className="flex w-5 justify-center" aria-hidden="true">×</span>
                      End room
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onToggleInspector}
            aria-label={inspectorOpen ? 'Close room details' : 'Open room details'}
            className="sr-only"
          />
        </div>
      </div>
    </header>
  );
}
