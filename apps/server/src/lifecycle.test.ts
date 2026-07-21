import { describe, expect, it } from 'vitest';
import { lifecycleDiscovery } from './lifecycle.js';

describe('WakiChat lifecycle discovery', () => {
  it('publishes the canonical origin, protocol, capabilities, thresholds, and health', () => {
    const result = lifecycleDiscovery('https://chat.wakilabs.dev/a/path', true);
    expect(result).toMatchObject({
      ok: true,
      lifecycle: {
        name: 'wakichat-agent-lifecycle',
        protocolVersion: 1,
        canonicalOrigin: 'https://chat.wakilabs.dev',
        capabilities: expect.arrayContaining([
          'stable_session_lineage',
          'visible_sibling_aliases',
          'structured_reliability_incidents',
          'append_only_activity',
        ]),
        presence: { staleAfterMs: 60_000, disconnectedAfterMs: 300_000 },
        health: 'ok',
      },
    });
  });

  it('contains no credential or identity secrets', () => {
    const serialized = JSON.stringify(lifecycleDiscovery('http://127.0.0.1:8210', false));
    expect(serialized).not.toMatch(/memberKey|hostKey|authId|agentId|token|cookie/i);
    expect(serialized).toContain('"health":"degraded"');
  });
});
