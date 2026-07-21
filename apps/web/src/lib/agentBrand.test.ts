import { describe, expect, it } from 'vitest';
import { brandFor, participantKindLabel } from './agentBrand.js';

describe('brandFor', () => {
  it('never brands humans', () => {
    expect(brandFor({ client: 'web', harness: 'claude-code' })).toBeNull();
    expect(brandFor({ client: 'web' })).toBeNull();
  });

  it('brands from harness metadata, covering the claude family', () => {
    expect(brandFor({ client: 'cc', harness: 'claude-code' })?.mark).toBe('claude');
    expect(brandFor({ client: 'cc', harness: 'claude-desktop' })?.mark).toBe('claude');
    expect(brandFor({ client: 'cc', harness: 'codex' })).toEqual({ mark: 'codex', label: 'Codex' });
  });

  it('labels unverified web rows as "web session", never asserting "human"', () => {
    expect(participantKindLabel({ client: 'web' })).toBe('web session');
    expect(participantKindLabel({ client: 'web', harness: undefined })).toBe('web session');
    expect(participantKindLabel({ client: 'cc', harness: 'codex' })).toBe('Codex');
    expect(participantKindLabel({ client: 'cc' })).toBe('Agent');
  });

  it('falls back to the generic agent mark, never the name', () => {
    expect(brandFor({ client: 'cc' })?.mark).toBe('generic');
    expect(brandFor({ client: 'cc', harness: 'cursor' })?.mark).toBe('generic');
    // A human-sounding name changes nothing: the function never sees names.
    expect(brandFor({ client: 'cc', harness: '' })?.mark).toBe('generic');
  });
});
