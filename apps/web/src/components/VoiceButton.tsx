import { useEffect, useRef, useState } from 'react';
import { DictationController, type DictationSnapshot, type RecognizerLike } from '../lib/dictation.js';

interface Props {
  /** Called once with the final transcript when the user Stops (accepts). */
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

// Browser SpeechRecognition is non-standard; `any` avoids pulling a lib in for
// one component. null when unsupported (Firefox, older Safari) → render nothing.
const SpeechRecognitionImpl: any =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const IDLE: DictationSnapshot = { state: 'idle', finalText: '', interim: '', elapsedMs: 0, error: null };

export function VoiceButton({ onTranscript, disabled }: Props) {
  const [snap, setSnap] = useState<DictationSnapshot>(IDLE);
  const ctrlRef = useRef<DictationController | null>(null);

  if (!SpeechRecognitionImpl) return null;

  function controller(): DictationController {
    if (!ctrlRef.current) {
      ctrlRef.current = new DictationController({
        createRecognizer: () => new SpeechRecognitionImpl() as RecognizerLike,
        lang: navigator.language || undefined,
        onChange: setSnap,
        onFinalize: (text) => { if (text) onTranscript(text); },
      });
    }
    return ctrlRef.current;
  }

  // Abort any in-flight session if the composer unmounts (accidental navigation).
  useEffect(() => () => { ctrlRef.current?.cancel(); }, []);

  const active = snap.state !== 'idle';
  const recording = snap.state === 'recording';
  const preview = (snap.finalText + (snap.interim ? ` ${snap.interim}` : '')).trim();

  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => (active ? controller().stop() : controller().start())}
        aria-label={active ? 'Stop dictation and insert text' : 'Start voice dictation'}
        title={active ? 'Stop dictation' : 'Start voice dictation'}
        aria-pressed={active}
        className={`text-base leading-none w-11 h-11 flex items-center justify-center rounded-lg transition ${
          recording
            ? 'bg-red-500/20 text-red-300'
            : snap.state === 'paused'
            ? 'bg-amber-500/20 text-amber-300'
            : 'bg-surface-softer text-ink-soft hover:bg-accent-tint hover:text-accent'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        🎤
      </button>

      {active && (
        // Recording panel floats ABOVE the composer so it never covers the
        // bottom controls. aria-live announces recording/paused changes.
        <div
          role="group"
          aria-label="Dictation controls"
          className="absolute bottom-full left-0 z-30 mb-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-3 shadow-lg"
        >
          <div className="flex items-center gap-2" aria-live="polite">
            <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${recording ? 'bg-red-400 animate-pulse' : 'bg-amber-400'}`} aria-hidden="true" />
            <span className="text-[13px] font-semibold text-ink">{recording ? 'Recording' : 'Paused'}</span>
            {recording && (
              <span className="ml-0.5 flex items-end gap-0.5" aria-hidden="true">
                {[0, 1, 2, 3].map(i => (
                  <span
                    key={i}
                    className="w-0.5 rounded-full bg-red-400/80 animate-[voicebar_0.9s_ease-in-out_infinite]"
                    style={{ height: 6 + (i % 3) * 4, animationDelay: `${i * 0.12}s` }}
                  />
                ))}
              </span>
            )}
            <span className="ml-auto font-mono text-[12px] tabular-nums text-ink-soft" aria-label={`Elapsed ${mmss(snap.elapsedMs)}`}>
              {mmss(snap.elapsedMs)}
            </span>
          </div>

          {snap.error && <div className="mt-2 text-[11px] font-semibold text-red-300">{snap.error}</div>}

          <div className="mt-2 max-h-20 overflow-y-auto text-[13px] leading-snug text-ink-soft">
            {preview ? (
              <span>{snap.finalText}{snap.interim && <span className="italic text-ink-faint"> {snap.interim}</span>}</span>
            ) : (
              <span className="italic text-ink-faint">Listening… speak now. Short pauses are fine.</span>
            )}
          </div>

          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => (recording ? controller().pause() : controller().resume())}
              className="min-h-9 flex-1 rounded-lg bg-surface-softer px-2 text-[12px] font-semibold text-ink transition hover:bg-surface"
            >
              {recording ? '⏸ Pause' : '▶ Resume'}
            </button>
            <button
              type="button"
              onClick={() => controller().stop()}
              aria-label="Stop and insert the transcript"
              className="min-h-9 flex-1 rounded-lg bg-accent px-2 text-[12px] font-bold text-white transition hover:opacity-90"
            >
              ✓ Stop
            </button>
            <button
              type="button"
              onClick={() => controller().cancel()}
              aria-label="Discard the transcript"
              className="min-h-9 rounded-lg border border-border px-2.5 text-[12px] font-semibold text-ink-muted transition hover:border-red-400/40 hover:text-red-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
