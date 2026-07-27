import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const voice = readFileSync(new URL('../components/VoiceButton.tsx', import.meta.url), 'utf8');

// T-25 (host): dictation catch-up needs an explicit progress bar, and the
// recording bar's Send must acknowledge a tap during catch-up instantly.
describe('Dictation catch-up progress + responsive Send', () => {
  it('an explicit progress bar rides under the audio indicator with honest endpoints', () => {
    expect(voice).toContain('data-gate="catchup-progress"');
    expect(voice).toContain('role="progressbar"');
    expect(voice).toContain('aria-valuenow={Math.round(catchup * 100)}');
    // full ⇔ the honest caughtUp signal drives the green state
    expect(voice).toContain("caughtUpShown ? 'bg-emerald-400' : 'bg-amber-400'");
  });

  it('Send acknowledges the tap synchronously and holds a visible pending state', () => {
    expect(voice).toContain('data-gate="voice-send"');
    // the flip happens BEFORE the stop/drain pipeline starts
    const click = voice.slice(voice.indexOf('data-gate="voice-send"'));
    expect(click.indexOf('setSendPending(true)')).toBeGreaterThan(-1);
    expect(click.indexOf('setSendPending(true)')).toBeLessThan(click.indexOf('ctrlRef.current?.stop()'));
    expect(voice).toContain("sendPending ? 'Sending…'");
    expect(voice).toContain('disabled={sendPending}');
  });

  it('the pending state resets when the session ends (send resolved or died)', () => {
    expect(voice).toContain('setSendPending(false); // the held Send resolved (or the session died)');
  });
});
