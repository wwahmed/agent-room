import { describe, expect, it } from 'vitest';
import { validateJoinParticipant } from './joinParticipant.js';

describe('join participant validation', () => {
  it('accepts a complete web or agent identity', () => {
    expect(() => validateJoinParticipant({ name: 'Waqas', client: 'web' })).not.toThrow();
    expect(() => validateJoinParticipant({ name: 'Builder', client: 'cc' })).not.toThrow();
  });

  it('rejects the legacy name/role-only remint payload that created suffix storms', () => {
    expect(() => validateJoinParticipant({ name: 'Waqas', role: 'Host' }))
      .toThrow('participant.client must be "web" or "cc".');
  });

  it('rejects an absent or nameless participant', () => {
    expect(() => validateJoinParticipant(undefined)).toThrow('participant is required.');
    expect(() => validateJoinParticipant({ name: '', client: 'web' }))
      .toThrow('participant.name is required.');
  });
});
