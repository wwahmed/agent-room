import type { Message, RoomQuestion } from '@agent-room/shared';

interface Props {
  message: Message;
  question?: RoomQuestion;
  isOwner: boolean;
  onOpen: () => void;
}

export function QuestionArtifactCard({ message, question, isOwner, onOpen }: Props) {
  const state = question?.answer ? 'Completed' : question ? 'Pending' : 'Owner-only';
  return (
    <div id={`msg-${message.id}`} className="mx-3 my-3 sm:mx-5">
      <button
        type="button"
        onClick={onOpen}
        className="group mx-auto flex w-full max-w-xl items-center gap-3 rounded-2xl border border-accent-tint-border bg-surface px-4 py-3 text-left shadow-sm transition hover:border-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={`${state} question artifact from ${message.metadata?.targetAgentName || message.name}. Open ${isOwner ? 'to review' : 'owner-only details'}.`}
      >
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-accent-tint text-accent" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 2.75h7l3 3v11.5H5z" />
            <path d="M12 2.75v3h3M7.5 9h5M7.5 12h3.5" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-accent">Question artifact</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${question?.answer ? 'bg-emerald-500/10 text-emerald-600' : question ? 'bg-amber-500/10 text-amber-600' : 'bg-surface-softer text-ink-soft'}`}>{state}</span>
          </span>
          <span className="mt-1 block truncate text-sm font-semibold text-ink">
            {isOwner && question ? question.prompt : 'Private decision for the room owner'}
          </span>
          <span className="mt-0.5 block text-xs text-ink-soft">Created by {message.metadata?.targetAgentName || message.name} · Open artifact</span>
        </span>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
      </button>
    </div>
  );
}
