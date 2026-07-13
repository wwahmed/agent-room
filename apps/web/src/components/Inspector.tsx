import { useState, type ReactNode } from 'react';
import { VersionTag } from './VersionTag.js';

// T-05 inspector shell. People / Outputs / Room settings move out of the
// old permanent side columns and mobile tab bar into ONE surface:
//   - desktop (lg+): a 320px right column, toggleable from the room bar
//   - mobile: a full-screen slide-over sheet
// The panel CONTENT stays owned by Room.tsx (it needs the room state and
// host handlers); this component only owns the responsive chrome, the
// tab strip, and dismissal.

export type InspectorTab = 'people' | 'project' | 'outputs' | 'room';

interface Props {
  open: boolean;
  onClose: () => void;
  renderTab: (tab: InspectorTab) => ReactNode;
  initialTab?: InspectorTab;
}

const TABS: Array<{ key: InspectorTab; label: string }> = [
  { key: 'people', label: 'People' },
  { key: 'project', label: 'Project' },
  { key: 'outputs', label: 'Outputs' },
  { key: 'room', label: 'Room' },
];

export function Inspector({ open, onClose, renderTab, initialTab = 'people' }: Props) {
  const [tab, setTab] = useState<InspectorTab>(initialTab);
  if (!open) return null;

  const panel = (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-[52px] flex-shrink-0 items-center gap-1 border-b border-border-faint px-1.5">
        <div className="flex min-w-0 flex-1 gap-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`min-h-11 flex-1 rounded-lg px-2 text-[13px] font-semibold transition ${tab === t.key ? 'bg-accent-tint text-accent' : 'text-ink-soft hover:bg-surface-softer'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface-softer hover:text-ink"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{renderTab(tab)}</div>
      {/* T-44: unobtrusive but discoverable build id, in the room's settings drawer. */}
      <div className="flex flex-shrink-0 items-center justify-end border-t border-border-faint px-3 py-1.5">
        <VersionTag />
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile: full-screen sheet over the chat. */}
      <div className="fixed inset-0 z-40 lg:hidden">
        <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
        <div className="absolute inset-y-0 right-0 w-full max-w-[420px] shadow-2xl">{panel}</div>
      </div>
      {/* Desktop: right column inside the workspace grid. */}
      <aside className="hidden min-h-0 w-[320px] flex-shrink-0 border-l border-border-faint lg:block">{panel}</aside>
    </>
  );
}
