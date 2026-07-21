import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { BRAND_LOGOS, InitialsChip } from './AgentAvatar.js';
import { brandFor } from '../lib/agentBrand.js';
import {
  facepileLabel,
  facepileSeverity,
  facepileTooltip,
  facepileWindow,
  isStaleState,
  type AgentFace,
} from '../lib/facepile.js';

// T-34 (T-31 spec v2, rev2 after UX geometry review): the agent facepile
// takes the room card's identity slot. At most three circles total — avatars,
// or 2 avatars + "+N" overflow — so the cluster always fits the fixed 64px
// identity column (R1). The health badge anchors to the CLUSTER's bottom-right
// corner with one anatomy for every composition (R2): quiet green dot when all
// agents respond, amber !-triangle plus dimmed stale avatars when some do, red
// triangle when none do. Severity is carried by color AND shape AND dimming
// AND the worded label, never color alone. The cluster is a deliberate
// 44px-target button opening the room's People panel; the surrounding card is
// a stretched link to the chat, so no interactive element nests in another.
// The tooltip renders in a body-level portal with collision-aware flip (R3):
// it can never be clipped by a scrolling or overflow ancestor.

interface Props {
  code: string;
  agentCount: number;
  agentStaleCount: number;
  agents: AgentFace[];
  /** Dense desktop pane sizing (smaller avatars, corner-tucked). */
  compact?: boolean;
}

// R2: ONE anchor rule — both badge variants sit on the cluster's bottom-right
// corner with identical offsets, overlapping the corner circle.
function badge(severity: 'healthy' | 'degraded' | 'down', animate: boolean) {
  if (severity === 'healthy') {
    return (
      <span
        className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-surface"
        aria-hidden="true"
      />
    );
  }
  const tone = severity === 'down' ? 'text-red-500' : 'text-amber-500';
  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center ${tone} ${animate ? 'facepile-degrade' : ''}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
        <path d="M8 1.8 15.2 14H.8L8 1.8Z" />
        <path d="M8 6v3.4M8 11.6v.1" stroke="rgb(var(--surface))" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </svg>
    </span>
  );
}

export function AgentFacepile({ code, agentCount, agentStaleCount, agents, compact = false }: Props) {
  const navigate = useNavigate();
  const severity = facepileSeverity(agentCount, agentStaleCount);
  const { visible, overflow } = facepileWindow(agents, agentCount);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // R3: portal tooltip with collision-aware placement. Flips below the
  // trigger when there is no headroom (the first card in a list).
  const [tip, setTip] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const showTip = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = rect.top < 56;
    setTip({ x: rect.left + rect.width / 2, y: below ? rect.bottom + 6 : rect.top - 6, below });
  };
  const hideTip = () => setTip(null);

  // S6: a single 300ms scale-in when the cluster DEGRADES — never on mount,
  // never looping. motion-reduce is handled by the keyframe's CSS guard.
  const prevStale = useRef(agentStaleCount);
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const degraded = agentStaleCount > prevStale.current;
    prevStale.current = agentStaleCount;
    if (!degraded) return;
    setAnimate(true);
    const timer = window.setTimeout(() => setAnimate(false), 350);
    return () => window.clearTimeout(timer);
  }, [agentStaleCount]);

  if (agentCount <= 0) return null;

  const size = compact ? 'h-5 w-5 text-fixed text-[10px]' : 'h-7 w-7 text-[12px]';
  const overlap = compact ? '-ml-2' : '-ml-3.5';
  const label = facepileLabel(agentCount, agentStaleCount);

  return (
    <span className={compact ? 'relative' : 'relative flex-shrink-0'}>
      <button
        ref={buttonRef}
        type="button"
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          navigate(`/r/${code}?panel=people`);
        }}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        aria-label={label}
        className={`relative z-10 -m-1.5 flex min-h-11 min-w-11 items-center justify-center rounded-xl p-1.5 transition hover:bg-surface-softer focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-tint ${compact ? 'min-h-9 min-w-9' : ''}`}
      >
        <span className="relative flex items-center">
          {visible.map((agent, i) => {
            // T-47: at 28px a known provider face uses the real app mark as
            // the base with the colored initials chip overlaid; below 28px
            // (compact) it inverts to monogram-only. Unknown providers keep
            // the monogram fallback at every size.
            const brand = !compact && agent.harness ? brandFor({ client: 'cc', harness: agent.harness }) : null;
            const logo = brand && (brand.mark === 'claude' || brand.mark === 'codex')
              ? BRAND_LOGOS[brand.mark as 'claude' | 'codex']
              : null;
            return (
              <span
                key={`${agent.name}-${i}`}
                className={`${size} ${i > 0 ? overlap : ''} text-fixed relative flex items-center justify-center rounded-full font-bold text-white ring-2 ring-surface ${
                  isStaleState(agent.state) ? 'opacity-45 grayscale' : ''
                }`}
                style={{ backgroundColor: agent.color, zIndex: visible.length + 1 - i }}
                aria-hidden="true"
              >
                {logo ? (
                  <>
                    <img src={logo} alt="" className="h-full w-full select-none rounded-full object-cover" />
                    <InitialsChip initials={agent.initials} color={agent.color} />
                  </>
                ) : agent.initials}
              </span>
            );
          })}
          {overflow > 0 && (
            <span
              className={`${size} ${visible.length > 0 ? overlap : ''} text-fixed flex items-center justify-center rounded-full bg-surface-softer font-bold text-ink-soft ring-2 ring-surface`}
              aria-hidden="true"
            >
              +{overflow}
            </span>
          )}
          {badge(severity, animate)}
        </span>
      </button>
      {tip && createPortal(
        <span
          role="tooltip"
          className="pointer-events-none fixed z-50 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-surface shadow-card"
          style={{
            left: tip.x,
            top: tip.y,
            transform: `translateX(-50%) ${tip.below ? '' : 'translateY(-100%)'}`,
          }}
        >
          {facepileTooltip(agentCount, agentStaleCount)}
        </span>,
        document.body,
      )}
    </span>
  );
}
