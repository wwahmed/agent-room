import { describe, it, expect } from 'vitest';
import { effectiveVerifier, verifierCollidesWithOwner } from './taskrules.js';

describe('effectiveVerifier', () => {
  it('returns the designated verifier when it differs from the owner', () => {
    expect(effectiveVerifier('Claude', 'UX-Adversary')).toBe('UX-Adversary');
  });
  it('drops the verifier when it equals the owner (impossible self-verify)', () => {
    expect(effectiveVerifier('Claude', 'Claude')).toBeUndefined();
  });
  it('returns undefined when no verifier is designated', () => {
    expect(effectiveVerifier('Claude', undefined)).toBeUndefined();
    expect(effectiveVerifier(undefined, undefined)).toBeUndefined();
  });
  it('keeps a verifier when the owner is unset', () => {
    expect(effectiveVerifier(undefined, 'UX-Adversary')).toBe('UX-Adversary');
  });
});

describe('verifierCollidesWithOwner', () => {
  it('is true only when a verifier is set and equals the owner', () => {
    expect(verifierCollidesWithOwner('Claude', 'Claude')).toBe(true);
    expect(verifierCollidesWithOwner('Claude', 'UX-Adversary')).toBe(false);
    expect(verifierCollidesWithOwner('Claude', undefined)).toBe(false);
    expect(verifierCollidesWithOwner(undefined, undefined)).toBe(false);
  });
});
