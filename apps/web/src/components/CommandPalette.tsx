import type { SlashCommand } from '../lib/slashCommands.js';

// T-141: the slash-command menu shown ABOVE the composer while the field holds a
// leading "/". Purely presentational — Room owns the open/filter/keyboard state;
// this renders the list and reports picks. Mouse selection uses onMouseDown so
// the textarea never loses focus mid-click (which would close the menu first).
export function CommandPalette({
  commands,
  activeIndex,
  onPick,
  onHover,
}: {
  commands: SlashCommand[];
  activeIndex: number;
  onPick: (command: SlashCommand) => void;
  onHover: (index: number) => void;
}) {
  if (commands.length === 0) return null;
  return (
    <div
      data-gate="command-palette"
      role="listbox"
      aria-label="Commands"
      className="absolute bottom-full left-0 z-40 mb-2 w-[min(92vw,26rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
    >
      <div className="border-b border-border/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        Commands
      </div>
      <ul className="max-h-64 overflow-y-auto py-1">
        {commands.map((c, i) => (
          <li key={c.label}>
            <button
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              data-gate="command-option"
              onMouseDown={(e) => { e.preventDefault(); onPick(c); }}
              onMouseEnter={() => onHover(i)}
              className={`flex w-full items-baseline gap-3 px-3 py-2 text-left transition ${
                i === activeIndex ? 'bg-accent/15' : 'hover:bg-surface-softer'
              }`}
            >
              <span className="flex-shrink-0 font-mono text-[13px] font-semibold text-accent">{c.label}</span>
              <span className="truncate text-[12px] text-ink-soft">{c.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
