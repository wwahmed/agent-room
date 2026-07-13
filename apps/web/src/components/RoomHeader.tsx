import { Link } from 'react-router-dom';
import type { Room } from '@agent-room/shared';

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
    <header className="flex h-[52px] flex-shrink-0 items-center gap-1.5 border-b border-border-faint bg-surface px-1.5 sm:px-3">
      <Link
        to="/"
        aria-label="Back to rooms"
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface-softer hover:text-ink lg:hidden"
      >
        <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10.5 3 5.5 8l5 5" />
        </svg>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold leading-tight">{room.topic}</div>
        <div className={`truncate text-[11px] leading-tight ${ended ? 'font-semibold text-red-400' : 'text-ink-faint'}`}>{presence}</div>
      </div>
      <button
        onClick={onShare}
        aria-label="Copy invite link"
        title="Copy invite link"
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface-softer hover:text-ink"
      >
        <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5.5a2 2 0 1 0-1.9-2.6L5.8 4.9a2 2 0 1 0 0 3.4l3.3 2a2 2 0 1 0 .5-.9l-3.3-2a2 2 0 0 0 0-1.6l3.3-2c.36.42.9.7 1.4.7Z" />
        </svg>
      </button>
      <button
        onClick={onToggleInspector}
        aria-label={inspectorOpen ? 'Close room details' : 'Open room details'}
        title="People, outputs, room settings"
        className={`flex h-11 min-w-11 flex-shrink-0 items-center justify-center gap-1 rounded-lg px-2 transition ${inspectorOpen ? 'bg-accent-tint text-accent' : 'text-ink-soft hover:bg-surface-softer hover:text-ink'}`}
      >
        <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="5.5" cy="5" r="2.25" />
          <path d="M1.75 13c.5-2.2 2-3.5 3.75-3.5S8.75 10.8 9.25 13" />
          <circle cx="11.5" cy="5.5" r="1.75" />
          <path d="M10.9 9.6c1.6.2 2.8 1.4 3.2 3.4" />
        </svg>
        <span className="text-[12px] font-semibold">{room.participants.length}</span>
      </button>
    </header>
  );
}
