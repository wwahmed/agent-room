import { describe, expect, it } from 'vitest';
import { brandFor, brandForSender, participantKindLabel } from './agentBrand.js';

describe('brandFor', () => {
  it('never brands humans', () => {
    expect(brandFor({ client: 'web', harness: 'claude-code' })).toBeNull();
    expect(brandFor({ client: 'web' })).toBeNull();
  });

  it('brands from harness metadata, covering the claude family', () => {
    expect(brandFor({ client: 'cc', harness: 'claude-code' })?.mark).toBe('claude');
    expect(brandFor({ client: 'cc', harness: 'claude-desktop' })?.mark).toBe('claude');
    expect(brandFor({ client: 'cc', harness: 'codex' })).toEqual({ mark: 'codex', label: 'Codex' });
    expect(brandFor({ client: 'cc', harness: 'copilot' })?.mark).toBe('copilot');
    expect(brandFor({ client: 'cc', harness: 'gemini-cli' })?.mark).toBe('gemini');
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

describe('brandForSender (T-47)', () => {
  const rows = [
    { name: 'Claude', client: 'cc', harness: 'claude-code' },
    { name: 'Impostor', client: 'cc', harness: 'codex' },
  ];

  it('harness metadata from the participant row outranks the name', () => {
    // The row says codex even though the display name suggests nothing.
    expect(brandForSender({ client: 'cc', name: 'Impostor' }, rows)?.mark).toBe('codex');
    expect(brandForSender({ client: 'cc', name: 'Claude' }, rows)?.mark).toBe('claude');
  });

  it('exact normalized name is the fallback when no row/harness exists', () => {
    expect(brandForSender({ client: 'cc', name: 'Claude (2)' }, [])?.mark).toBe('claude');
    expect(brandForSender({ client: 'cc', name: 'codex' }, [])?.mark).toBe('codex');
    // Substrings never match: a human-style name stays generic.
    expect(brandForSender({ client: 'cc', name: 'Claude Smith' }, [])?.mark).toBe('generic');
  });

  it('humans are never branded regardless of name', () => {
    expect(brandForSender({ client: 'web', name: 'Claude' }, rows)).toBeNull();
  });
});
