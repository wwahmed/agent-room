import { useState } from 'react';
import { MessageText } from './Bubble.js';
import { speakText, stopSpeaking } from '../lib/speak.js';

// T-139: renders an EXECUTIVE BRIEF card in the feed. The card text is the
// server-composed `display` rendering (honest by construction); the 🔊 button
// plays the `speech` rendering (same facts, IDs/URLs stripped) via local TTS.
// A brief is a room artifact, not a chat line, so it gets its own framed card.
export function BriefCard({ text, speech, scope, selfName }: { text: string; speech?: string; scope?: string; selfName?: string }) {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleSpeak() {
    if (speaking) { stopSpeaking(); setSpeaking(false); return; }
    if (!speech) return;
    setError(null);
    setSpeaking(true);
    try {
      await speakText(speech);
      // speakText resolves once playback STARTS; clear the pressed state when the
      // clip ends by polling the shared player is overkill — reset optimistically
      // after a tick so a second press can replay.
    } catch {
      setError('Audio unavailable.');
    } finally {
      // Leave the button in the "playing" look only briefly; the audio element
      // owns real end-of-play. A short reset keeps the control responsive.
      setTimeout(() => setSpeaking(false), 400);
    }
  }

  return (
    <div
      data-gate="brief-card"
      role="region"
      aria-label="Executive brief"
      className="my-3 rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3 shadow-sm"
    >
      <div className="mb-1 flex items-start justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-wide text-accent">
          Executive Brief{scope ? ` · ${scope}` : ''}
        </span>
        {speech && (
          <button
            type="button"
            onClick={toggleSpeak}
            data-gate="brief-speak"
            aria-label={speaking ? 'Stop playback' : 'Play brief aloud'}
            title={speaking ? 'Stop' : 'Play aloud'}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:bg-surface-softer hover:text-accent"
          >
            {speaking ? (
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1" /></svg>
            ) : (
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 3 4.5 6H2v4h2.5L8 13V3Z" /><path d="M11 6.2a2.5 2.5 0 0 1 0 3.6M12.8 4.5a5 5 0 0 1 0 7" />
              </svg>
            )}
          </button>
        )}
      </div>
      {/* The card already labels itself; drop the redundant glyph header line. */}
      <div data-gate="brief-body" className="text-[14px] leading-relaxed text-ink">
        <MessageText text={text.replace(/^📋\s*\*\*EXECUTIVE BRIEF\*\*\s*\n?/i, '')} selfName={selfName} />
      </div>
      {error && <p role="alert" className="mt-1 text-[12px] font-semibold text-red-400">{error}</p>}
    </div>
  );
}
