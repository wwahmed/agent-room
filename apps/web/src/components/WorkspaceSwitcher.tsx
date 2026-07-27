import { useEffect, useRef, useState } from 'react';

// T-71: the workspace switcher — the room's navigation system, living inside
// the command-bar shell (RoomHeader centers it at lg+, and renders it as the
// second row of the same header below lg; total mobile chrome 96px). Below lg
// the tabs are icon-over-label stacked (bottom-nav pattern); at lg+ icon and
// label sit in a row. The label is never dropped (T-42), it rides under the
// 16px glyph at the 12px floor (room-tab-label). No numeric badges at any
// width (design lead amendment).
//
// T-15 (host: "tabs at the top are too busy — promote some, put the rest in
// overflow"): the switcher now takes PRIMARY destinations plus an `overflow`
// list folded behind one "More" control. When the active destination lives in
// the overflow, the More control wears that destination's icon + label and
// the selected fill — the user never loses their place to the fold.
//
// Semantics (design lead source gate): honest navigation — <nav> +
// aria-current="page" — NOT an ARIA tablist, which would owe roving focus
// and tabpanel wiring these page-level destinations don't have. The More
// control is the one true menu here (aria-haspopup + role="menu"), closing
// on select, outside-click, and Escape.

export interface WorkspaceDestination {
  key: string;
  label: string;
  icon: React.ReactNode;
}

const TAB_CLASS = (selected: boolean) =>
  `room-tab-label flex h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:flex-none lg:flex-row lg:gap-1.5 lg:px-3.5 ${
    selected ? 'workspace-active' : 'workspace-idle hover:bg-surface-softer'
  }`;

function TabIcon({ icon }: { icon: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {icon}
    </svg>
  );
}

export function WorkspaceSwitcher({ destinations, overflow = [], active, onSelect }: {
  destinations: WorkspaceDestination[];
  /** T-15: destinations folded behind the "More" control. */
  overflow?: WorkspaceDestination[];
  /** null = no destination selected (e.g. the Settings page is open). */
  active: string | null;
  onSelect: (key: string) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  // The active destination when it lives behind the fold — the More control
  // impersonates it (icon, label, selected fill) so navigation stays honest.
  const activeOverflow = overflow.find(d => d.key === active) ?? null;

  return (
    <nav aria-label="Workspace" className="flex h-11 w-full items-center gap-1 lg:w-auto">
      {destinations.map(d => (
        <button
          key={d.key}
          type="button"
          aria-current={active === d.key ? 'page' : undefined}
          onClick={() => onSelect(d.key)}
          className={TAB_CLASS(active === d.key)}
        >
          <TabIcon icon={d.icon} />
          <span className="max-w-full truncate">{d.label}</span>
        </button>
      ))}
      {overflow.length > 0 && (
        <div ref={moreRef} className="relative flex min-w-0 flex-1 lg:flex-none">
          <button
            type="button"
            data-gate="tab-overflow"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-current={activeOverflow ? 'page' : undefined}
            onClick={() => setMoreOpen(v => !v)}
            className={`${TAB_CLASS(Boolean(activeOverflow))} w-full`}
          >
            <TabIcon icon={activeOverflow ? activeOverflow.icon : <><circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="13" cy="8" r="1.4" /></>} />
            <span className="max-w-full truncate">{activeOverflow ? activeOverflow.label : 'More'}</span>
          </button>
          {moreOpen && (
            <div
              role="menu"
              aria-label="More destinations"
              className="absolute right-0 top-12 z-40 min-w-[176px] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
            >
              {overflow.map(d => (
                <button
                  key={d.key}
                  type="button"
                  role="menuitem"
                  aria-current={active === d.key ? 'page' : undefined}
                  onClick={() => { setMoreOpen(false); onSelect(d.key); }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-semibold transition hover:bg-surface-softer ${
                    active === d.key ? 'text-accent' : 'text-ink'
                  }`}
                >
                  <TabIcon icon={d.icon} />
                  {d.label}
                  {active === d.key && (
                    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="ml-auto shrink-0">
                      <path d="m3 8.5 3.5 3.5L13 5" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
