import { Link } from 'react-router-dom';
import type { Room } from '@agent-room/shared';
import { ThemeToggle } from './ThemeToggle.js';

// T-05 compact room bar: ONE 52px row in the same WakiChat shell
// language as Home (host: "chat itself has an ugly header"). Back +
// title + quiet presence on the left; share + inspector toggle on the
// right. Everything secondary lives in the Inspector, not extra header
// bands.

interface Props {
  room: Room;
  ended: boolean;
  listeningCount: number;
  inspectorOpen: boolean;
  onShare: () => void;
  onToggleInspector: () => void;
}

export function RoomHeader({ room, ended, listeningCount, inspectorOpen, onShare, onToggleInspector }: Props) {
  const presence = ended
    ? 'Meeting ended'
    : `${room.participants.length} here${listeningCount > 0 ? ` · ${listeningCount} listening` : ''}`;

  return (
    <header className="flex h-[60px] flex-shrink-0 items-center border-b border-border-faint bg-surface px-1.5 sm:px-3">
      {/* T-21: header content shares the feed's reading measure. T-46 (Waqas:
          "top bar and buttons are microscopic"): taller bar, larger title,
          bigger icon controls. */}
      <div className="mx-auto flex h-full w-full max-w-[860px] items-center gap-1.5">
      <Link
        to="/"
        aria-label="Back to rooms"
        className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface-softer hover:text-ink lg:hidden"
      >
        <svg viewBox="0 0 16 16" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10.5 3 5.5 8l5 5" />
        </svg>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] font-semibold leading-tight">{room.topic}</div>
        <div className={`truncate text-[12px] leading-tight ${ended ? 'font-semibold text-red-400' : 'text-ink-faint'}`}>{presence}</div>
      </div>
      <ThemeToggle className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface-softer hover:text-ink" />
      <button
        onClick={onShare}
        aria-label="Copy invite link"
        title="Copy invite link"
        className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface-softer hover:text-ink"
      >
        <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5.5a2 2 0 1 0-1.9-2.6L5.8 4.9a2 2 0 1 0 0 3.4l3.3 2a2 2 0 1 0 .5-.9l-3.3-2a2 2 0 0 0 0-1.6l3.3-2c.36.42.9.7 1.4.7Z" />
        </svg>
      </button>
      <button
        onClick={onToggleInspector}
        aria-label={inspectorOpen ? 'Close room details' : 'Open room details'}
        title="People, outputs, room settings"
        /* lg:hidden — on desktop these panels are peer tabs under the header
           (T-64), so this toggle would open a sheet that no longer exists there. */
        className={`flex h-12 min-w-12 flex-shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 transition lg:hidden ${inspectorOpen ? 'bg-accent-tint text-accent' : 'text-ink-soft hover:bg-surface-softer hover:text-ink'}`}
      >
        <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="5.5" cy="5" r="2.25" />
          <path d="M1.75 13c.5-2.2 2-3.5 3.75-3.5S8.75 10.8 9.25 13" />
          <circle cx="11.5" cy="5.5" r="1.75" />
          <path d="M10.9 9.6c1.6.2 2.8 1.4 3.2 3.4" />
        </svg>
        <span className="text-[13px] font-semibold">{room.participants.length}</span>
      </button>
      </div>
    </header>
  );
}
