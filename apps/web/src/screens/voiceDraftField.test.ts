import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./Room.tsx', import.meta.url), 'utf8');

// T-128: when voice recording starts the draft field opens ALREADY multi-line
// and reads as a distinct live-transcription surface (accent chrome + a labeled,
// gently animated indicator), visibly different from the single-line box you
// type into. It still grows under the T-119/T-120 full-width and T-85 cap rules.
describe('voice-draft field is a distinct transcription surface (T-128)', () => {
  it('opens at a multi-line dictating minimum height, not the single-line rest', () => {
    expect(source).toContain('const TEXTAREA_DICTATING_MIN =');
    // both the auto-grow floor and the initial inline height key off `dictating`
    expect(source).toContain('dictating ? TEXTAREA_DICTATING_MIN');
  });

  it('re-measures the field height when recording flips on/off', () => {
    expect(source).toContain('}, [text, composerExpanded, dictating]);');
  });

  it('carries NO instructional captions — the composite meter and field accent are the language (host UX order)', () => {
    // The T-128 "Transcribing your voice" banner and the "Voice draft:
    // editable" narration are gone; the recording bar's catch-up meter and
    // the field's recording accent say the same things visually.
    expect(source).not.toContain('data-gate="transcribing"');
    expect(source).not.toContain('Transcribing your voice');
    expect(source).not.toContain('Voice draft: editable');
  });

  it('gives the whole field an always-on recording accent, distinct from typing focus', () => {
    expect(source).toContain("data-recording={dictating ? 'true' : undefined}");
    expect(source).toContain("dictating ? 'border-accent ring-4 ring-accent-tint'");
  });
});
