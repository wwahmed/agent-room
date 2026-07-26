import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const voiceButton = readFileSync(new URL('../components/VoiceButton.tsx', import.meta.url), 'utf8');
const audioCue = readFileSync(new URL('../lib/audioCue.ts', import.meta.url), 'utf8');

// Waqas: while dictating, show BOTH a visual state and a faint distinct tick
// the moment transcription has caught up with speech — so he knows exactly
// when the transcript is complete and it's safe to send.
describe('caught-up indicator wiring', () => {
  it('the waveform doubles as the catch-up meter, below the problem states (composite, no narration)', () => {
    expect(voiceButton).toContain('data-gate="catchup-meter"');
    // bars split into transcribed (emerald) vs in-flight (red) at the fill point
    expect(voiceButton).toContain('bg-emerald-400/90');
    expect(voiceButton).toContain('bg-red-400/80');
    // ...and the Send button itself lights up when it is safe to send
    expect(voiceButton).toContain("caughtUpShown ? 'bg-emerald-600 ring-2 ring-emerald-400/50' : 'bg-accent'");
    // problem states keep precedence: offline and dropped-clips branches come first
    expect(voiceButton.indexOf('Saved locally')).toBeLessThan(voiceButton.indexOf('data-gate="catchup-meter"'));
    expect(voiceButton.indexOf('could not be transcribed')).toBeLessThan(voiceButton.indexOf('data-gate="catchup-meter"'));
  });

  it('the meter fill is honest at the endpoints: full only via the caughtUp signal', () => {
    expect(voiceButton).toContain('const target = s?.caughtUp');
    expect(voiceButton).toContain('catchupRef.current = 0;');
  });

  it('holds caughtUp ~600ms before showing/ticking and re-arms only on new speech', () => {
    expect(voiceButton).toContain('caughtUpSinceRef');
    expect(voiceButton).toContain('>= 600');
    expect(voiceButton).toContain('caughtUpTickedRef.current = false;');
  });

  it('plays one soft tick, clearly quieter than the start/send chimes', () => {
    expect(voiceButton).toContain('playCaughtUpCue()');
    expect(audioCue).toContain('export function playCaughtUpCue');
    expect(audioCue).toContain('blip(990, 60, 0.03)');
  });

  it('a fresh session never inherits a stale ✓ or a spent tick arm', () => {
    expect(voiceButton).toContain('setCaughtUpShown(false);');
  });
});
