import { Avatar } from './Avatar.js';
import { brandFor, type AgentBrand } from '../lib/agentBrand.js';

// T-47 avatar system (host direction 04:14 + T-44 DoD): known providers use
// their real app marks as the avatar BASE, with the participant's colored
// initials chip overlaid bottom-right so multiple same-provider agents stay
// distinguishable. Unknown agents keep the deliberate generic fallback (their
// colored monogram + a small abstract bot badge); humans are always the plain
// colored monogram, never brand-marked. Below 28px there is no room for a
// legible overlay, so small sizes invert to monogram-only.
//
// Chip initials render at 9px — the floor for avatar-internal text (T-47);
// text-fixed opts them out of the T-61 prose floor, same as Avatar itself.

export const BRAND_LOGOS: Record<'claude' | 'codex' | 'copilot' | 'gemini', string> = {
  claude: '/brand/agents/claude.png',
  codex: '/brand/agents/codex.png',
  copilot: '/brand/agents/copilot.svg',
  gemini: '/brand/agents/gemini.svg',
};

export function brandLogoFor(mark: string): string | null {
  return mark in BRAND_LOGOS ? BRAND_LOGOS[mark as keyof typeof BRAND_LOGOS] : null;
}

const GENERIC_MARK = (
  <svg viewBox="0 0 16 16" width="8" height="8" fill="currentColor" aria-hidden="true">
    <rect x="2" y="5" width="12" height="8" rx="2.5" />
    <path d="M8 2v3" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

/** Colored initials chip overlaid on a logo base. */
export function InitialsChip({ initials, color }: { initials: string; color: string }) {
  return (
    <span
      className="text-fixed absolute -bottom-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-bold text-white ring-2 ring-surface"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

/** Abstract bot badge for agents whose provider is unknown. */
export function GenericAgentBadge() {
  return (
    <span
      className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface text-ink-soft ring-1 ring-border-faint"
      aria-hidden="true"
    >
      {GENERIC_MARK}
    </span>
  );
}

/** Logo-base avatar with the initials chip; sizeClass sizes the square.
 *  withChip=false renders the bare mark — used below 28px, where an overlay
 *  chip is illegible but the provider logo itself still reads (Waqas:
 *  provider logos consistently, at every size). */
export function BrandedLogoAvatar({ brand, initials, color, sizeClass, withChip = true }: { brand: AgentBrand; initials: string; color: string; sizeClass: string; withChip?: boolean }) {
  return (
    <span className={`relative inline-flex ${sizeClass} flex-shrink-0`} title={`${brand.label} · ${initials}`}>
      <img
        src={brandLogoFor(brand.mark) ?? undefined}
        alt=""
        className={`${sizeClass} select-none rounded-lg object-cover`}
        aria-hidden="true"
      />
      {withChip && <InitialsChip initials={initials} color={color} />}
    </span>
  );
}

interface Props {
  participant: { name: string; initials: string; color: string; client: string; harness?: string };
  size?: 'sm' | 'md' | 'lg';
}

export function AgentAvatar({ participant, size = 'md' }: Props) {
  const brand = brandFor(participant);
  if (!brand) return <Avatar initials={participant.initials} color={participant.color} size={size} />;
  if (brandLogoFor(brand.mark)) {
    const sizeClass = size === 'lg' ? 'h-8 w-8' : size === 'md' ? 'h-6 w-6' : 'h-5 w-5';
    // Waqas: the provider logo at EVERY size. Below 28px the initials chip is
    // illegible, so sm drops the chip rather than dropping the logo.
    return <BrandedLogoAvatar brand={brand} initials={participant.initials} color={participant.color} sizeClass={sizeClass} withChip={size !== 'sm'} />;
  }
  return (
    <span className="relative inline-flex flex-shrink-0" title={brand.label}>
      <Avatar initials={participant.initials} color={participant.color} size={size} />
      <GenericAgentBadge />
    </span>
  );
}
