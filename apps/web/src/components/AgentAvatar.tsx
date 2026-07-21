import { Avatar } from './Avatar.js';
import { brandFor } from '../lib/agentBrand.js';

// T-44/T-47: an Avatar with the provider mark riding its corner. The base
// circle stays the participant's color + initials (per-participant identity);
// the small badge carries the harness brand (provider identity). Humans get
// the plain Avatar — never a brand mark. Marks are abstract 8px glyphs, no
// text, so nothing here can fall below the avatar type floor.

const MARKS = {
  claude: (
    // four-point spark, Anthropic coral
    <svg viewBox="0 0 16 16" width="8" height="8" fill="#D97757" aria-hidden="true">
      <path d="M8 1c.9 3.4 2.6 5.1 6 6-3.4.9-5.1 2.6-6 6-.9-3.4-2.6-5.1-6-6 3.4-.9 5.1-2.6 6-6Z" />
    </svg>
  ),
  codex: (
    // hex knot
    <svg viewBox="0 0 16 16" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M8 1.8 13.4 5v6L8 14.2 2.6 11V5L8 1.8Z" />
    </svg>
  ),
  generic: (
    // simple bot dot-pair
    <svg viewBox="0 0 16 16" width="8" height="8" fill="currentColor" aria-hidden="true">
      <rect x="2" y="5" width="12" height="8" rx="2.5" />
      <path d="M8 2v3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
} as const;

interface Props {
  participant: { name: string; initials: string; color: string; client: string; harness?: string };
  size?: 'sm' | 'md' | 'lg';
}

export function AgentAvatar({ participant, size = 'md' }: Props) {
  const brand = brandFor(participant);
  if (!brand) return <Avatar initials={participant.initials} color={participant.color} size={size} />;
  return (
    <span className="relative inline-flex flex-shrink-0" title={brand.label}>
      <Avatar initials={participant.initials} color={participant.color} size={size} />
      <span
        className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface text-ink-soft ring-1 ring-border-faint"
        aria-hidden="true"
      >
        {MARKS[brand.mark]}
      </span>
    </span>
  );
}
