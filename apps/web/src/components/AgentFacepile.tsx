import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  facepileLabel,
  facepileSeverity,
  facepileTooltip,
  facepileWindow,
  isStaleState,
  type AgentFace,
} from '../lib/facepile.js';

// T-34 (T-31 spec v2): the agent facepile takes the room card's identity slot.
// Up to three overlapping avatars + "+N" overflow, with the health badge ON
// the cluster: quiet green dot when all agents respond, amber !-triangle plus
// a dimmed stale avatar when some do, red triangle when none do. Severity is
// carried by color AND shape AND dimming AND the worded label, never color
// alone. The cluster itself is a deliberate 44px-target button that opens the
// room's People panel; the surrounding card is a stretched link to the chat,
// so there are no nested interactive elements.

interface Props {
  code: string;
  agentCount: number;
  agentStaleCount: number;
  agents: AgentFace[];
  /** Dense desktop pane sizing (smaller avatars, corner-tucked). */
  compact?: boolean;
}

function badge(severity: 'healthy' | 'degraded' | 'down', animate: boolean) {
  if (severity === 'healthy') {
    return (
      <span
        className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-surface"
        aria-hidden="true"
      />
    );
  }
  // Degraded/down: triangle glyph — shape carries the verdict alongside color.
  const tone = severity === 'down' ? 'text-red-500' : 'text-amber-500';
  return (
    <span
      className={`absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center ${tone} ${animate ? 'facepile-degrade' : ''}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
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

  // Avatar initials are geometry, not editorial type — text-fixed opts the
  // compact 20px circle out of the floor clamp exactly like Avatar.tsx.
  const size = compact ? 'h-5 w-5 text-fixed text-[10px]' : 'h-7 w-7 text-[12px]';
  const label = facepileLabel(agentCount, agentStaleCount);

  return (
    <span className={`group relative ${compact ? '' : 'flex-shrink-0'}`}>
      <button
        type="button"
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          navigate(`/r/${code}?panel=people`);
        }}
        aria-label={label}
        className={`relative z-10 -m-1.5 flex min-h-11 min-w-11 items-center justify-center rounded-xl p-1.5 transition hover:bg-surface-softer focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-tint ${compact ? 'min-h-9 min-w-9' : ''}`}
      >
        <span className="relative flex items-center">
          {visible.map((agent, i) => (
            <span
              key={`${agent.name}-${i}`}
              className={`${size} ${i > 0 ? '-ml-2' : ''} text-fixed flex items-center justify-center rounded-full font-bold text-white ring-2 ring-surface ${
                isStaleState(agent.state) ? 'opacity-45 grayscale' : ''
              }`}
              style={{ backgroundColor: agent.color, zIndex: visible.length - i }}
              aria-hidden="true"
            >
              {agent.initials}
            </span>
          ))}
          {overflow > 0 && (
            <span
              className={`${size} -ml-2 text-fixed flex items-center justify-center rounded-full bg-surface-softer font-bold text-ink-soft ring-2 ring-surface`}
              aria-hidden="true"
            >
              +{overflow}
            </span>
          )}
          {badge(severity, animate)}
        </span>
      </button>
      {/* S7: a real tooltip, keyboard-reachable via focus, not a bare title. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-surface shadow-card group-hover:block group-focus-within:block"
      >
        {facepileTooltip(agentCount, agentStaleCount)}
      </span>
    </span>
  );
}
