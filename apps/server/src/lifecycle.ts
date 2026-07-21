import { AGENT_LIFECYCLE_PROTOCOL_VERSION } from '@agent-room/shared';
import { PRESENCE_DISCONNECTED_MS, PRESENCE_STALE_MS } from './health.js';

export const AGENT_LIFECYCLE_CAPABILITIES = [
  'stable_session_lineage',
  'credential_scoped_rejoin',
  'cursor_resume',
  'exact_removal_provenance',
  'visible_sibling_aliases',
  'structured_reliability_incidents',
  'append_only_activity',
] as const;

export function lifecycleDiscovery(canonicalOrigin: string, healthy: boolean) {
  const origin = new URL(canonicalOrigin).origin;
  return {
    ok: healthy,
    lifecycle: {
      name: 'wakichat-agent-lifecycle',
      protocolVersion: AGENT_LIFECYCLE_PROTOCOL_VERSION,
      canonicalOrigin: origin,
      capabilities: AGENT_LIFECYCLE_CAPABILITIES,
      presence: {
        staleAfterMs: PRESENCE_STALE_MS,
        disconnectedAfterMs: PRESENCE_DISCONNECTED_MS,
      },
      health: healthy ? 'ok' : 'degraded',
    },
  } as const;
}
