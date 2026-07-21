// T-71: the workspace switcher — four destinations, ONE navigation system,
// living inside the command-bar shell (RoomHeader centers it at lg+, and
// renders it as the second row of the same header below lg; total mobile
// chrome 96px). Label-only on phones at the 17px floor (room-tab-label);
// icons join at lg. No numeric badges at any width (design lead amendment).
//
// Semantics (design lead source gate): honest navigation — <nav> +
// aria-current="page" — NOT an ARIA tablist, which would owe roving focus
// and tabpanel wiring these page-level destinations don't have. Hover,
// selected, and focus are three distinguishable states: hover tints the
// surface, selected fills accent-tint, focus-visible draws the accent ring.

export interface WorkspaceDestination {
  key: string;
  label: string;
  icon: React.ReactNode;
}

export function WorkspaceSwitcher({ destinations, active, onSelect }: {
  destinations: WorkspaceDestination[];
  /** null = no destination selected (e.g. the Settings page is open). */
  active: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <nav aria-label="Workspace" className="flex h-11 w-full items-center gap-1 lg:w-auto">
      {destinations.map(d => (
        <button
          key={d.key}
          type="button"
          aria-current={active === d.key ? 'page' : undefined}
          onClick={() => onSelect(d.key)}
          className={`room-tab-label flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-1 font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:flex-none lg:px-3.5 ${
            active === d.key
              ? 'workspace-active'
              : 'workspace-idle hover:bg-surface-softer'
          }`}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="hidden lg:block">
            {d.icon}
          </svg>
          <span className="truncate">{d.label}</span>
        </button>
      ))}
    </nav>
  );
}
