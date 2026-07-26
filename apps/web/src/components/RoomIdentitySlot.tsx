import { AgentFacepile } from './AgentFacepile.js';

interface Props {
  code: string;
  agentCount: number;
  agentStaleCount: number;
  agents: Array<{
    name: string;
    color: string;
    initials: string;
    state: 'listening' | 'online' | 'working' | 'stale' | 'disconnected';
  }>;
  /** Compact sizing for the 280px in-room desktop list. */
  compact?: boolean;
  /** Ended rooms keep the column alignment without showing live presence. */
  showFallback?: boolean;
}

// T-55: one left-side identity slot for every room list. Home and the
// in-room desktop list deliberately share this component so the facepile
// cannot drift from left to right as the two rows evolve independently.
export function RoomIdentitySlot({
  code,
  agentCount,
  agentStaleCount,
  agents,
  compact = false,
  showFallback = true,
}: Props) {
  return (
    <div
      className={`relative z-10 flex flex-shrink-0 items-center justify-start ${compact ? 'w-11' : 'w-16'}`}
      data-room-identity-slot="left"
    >
      {agentCount > 0 ? (
        <AgentFacepile
          code={code}
          agentCount={agentCount}
          agentStaleCount={agentStaleCount}
          agents={agents}
          compact={compact}
        />
      ) : showFallback ? (
        <div
          className={`flex items-center justify-center bg-accent-tint text-accent ${compact ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl'}`}
          aria-hidden="true"
        >
          ◇
        </div>
      ) : null}
    </div>
  );
}
