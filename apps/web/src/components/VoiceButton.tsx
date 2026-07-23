import { useEffect, useRef, useState } from 'react';
import { DictationController, mergeTranscript, type DictationSnapshot, type RecognizerLike } from '../lib/dictation.js';
import { ScreenWakeLockController } from '../lib/screenWakeLock.js';

interface Props {
  /** T-119: while dictation is active the recording overlay carries every
   *  control, so the trigger can yield its row slot to the draft text. */
  hideTriggerWhileActive?: boolean;
  /** Called once with the final transcript when the user Stops (accepts). */
  onTranscript: (text: string) => void;
  /** T-59: called continuously while recording with the live (final+interim)
   *  transcript, so the words stream straight into the message box as they're
   *  spoken and nothing is ever lost if the session ends unexpectedly. */
  onLiveTranscript?: (text: string) => void;
  /** Fired when recording begins, so the composer can snapshot its base draft. */
  onStart?: () => void;
  /** Fired when the user discards (🗑), so the composer can revert to the base. */
  onCancel?: () => void;
  disabled?: boolean;
}

// The live transcript = committed words plus the not-yet-final interim tail.
function liveText(s: DictationSnapshot): string {
  return mergeTranscript(s.finalText, s.interim);
}

// Browser SpeechRecognition is non-standard; `any` avoids pulling a lib in for
// one component. null when unsupported (Firefox, older Safari) → render nothing.
// T-130: the OS "listening" beep on recognizer start is a mobile behavior
// (Android/iOS). Desktop browsers do not beep, so only mobile needs the
// no-mid-recording-restart treatment.
const MOBILE_BEEPS = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');

const SpeechRecognitionImpl: any =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

function mmss(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const IDLE: DictationSnapshot = {
  state: 'idle', finalText: '', interim: '', elapsedMs: 0, error: null,
  hasHeardSpeech: false, restarts: 0, lastTransientError: null,
};
const BARS = 22;
// T-108: after this much recording with zero recognition results, stop
// pretending — replace the decorative waveform with a diagnosis.
const NO_SIGNAL_AFTER_MS = 6000;

function noSignalMessage(s: DictationSnapshot): string {
  if (s.lastTransientError === 'no-speech' || s.lastTransientError === null) {
    return 'Hearing nothing. Check the mic input in your browser.';
  }
  if (s.lastTransientError === 'aborted' || s.restarts > 2) {
    return `Speech service keeps disconnecting (${s.lastTransientError ?? 'restart loop'})`;
  }
  return `No transcription yet (${s.lastTransientError})`;
}

export function VoiceButton({ onTranscript, onLiveTranscript, onStart, onCancel, disabled, hideTriggerWhileActive }: Props) {
  const [snap, setSnap] = useState<DictationSnapshot>(IDLE);
  const [tick, setTick] = useState(0);
  const ctrlRef = useRef<DictationController | null>(null);
  const wakeLockRef = useRef<ScreenWakeLockController | null>(null);

  // The controller is created once; keep the latest callbacks in refs so its
  // long-lived onChange/onFinalize always call the current handlers.
  const onTranscriptRef = useRef(onTranscript);
  const onLiveRef = useRef(onLiveTranscript);
  onTranscriptRef.current = onTranscript;
  onLiveRef.current = onLiveTranscript;

  const recording = snap.state === 'recording';
  const active = snap.state !== 'idle';

  // Keep the display awake only for the lifetime of the voice-recording mode.
  // The controller is best-effort, releases on stop/error/cancel/unmount, and
  // reacquires after a hidden recording tab becomes visible again.
  useEffect(() => {
    const wakeLock = new ScreenWakeLockController();
    wakeLockRef.current = wakeLock;
    return () => {
      wakeLockRef.current = null;
      wakeLock.dispose();
    };
  }, []);

  useEffect(() => {
    wakeLockRef.current?.setActive(active);
  }, [active]);

  // T-57: drive a continuous clock while recording — the controller only emits on
  // speech events, so without this the timer sits at 0:00 during silence and the
  // waveform never moves. Re-read the snapshot (fresh elapsedMs + interim) and
  // advance the animation phase ~5×/sec.
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      const c = ctrlRef.current;
      if (c) setSnap(c.snapshot());
      setTick(t => t + 1);
    }, 200);
    return () => window.clearInterval(id);
  }, [active]);

  // Abort any in-flight session if the composer unmounts (accidental navigation).
  useEffect(() => () => { ctrlRef.current?.cancel(); }, []);

  if (!SpeechRecognitionImpl) return null;

  function controller(): DictationController {
    if (!ctrlRef.current) {
      ctrlRef.current = new DictationController({
        createRecognizer: () => new SpeechRecognitionImpl() as RecognizerLike,
        lang: navigator.language || undefined,
        // T-130 (host ruling): on mobile, the OS plays a "listening" beep on
        // every recognizer start, so restarting mid-recording beeps through the
        // user's speech. Disable the pause-restart there — the single
        // continuous session beeps once at start and finalizes on a real
        // silence (no mid beeps). Desktop has no such beep and keeps restarting
        // so a pause never loses the draft (T-107).
        restartOnPause: !MOBILE_BEEPS,
        // T-59: stream every update into the composer as it's spoken (not just at
        // the end), so a dropped final event can never swallow what was said.
        onChange: (s) => { setSnap(s); if (s.state !== 'idle') onLiveRef.current?.(liveText(s)); },
        onFinalize: (text) => { if (text) onTranscriptRef.current?.(text); },
      });
    }
    return ctrlRef.current;
  }

  return (
    <div className="flex-shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (active) { controller().stop(); return; }
          onStart?.(); // snapshot the composer's base draft before words stream in
          controller().start();
        }}
        aria-label={active ? 'Stop dictation and insert text' : 'Start voice dictation'}
        title={active ? 'Stop dictation' : 'Start voice dictation'}
        aria-pressed={active}
        className={`text-base leading-none w-11 h-11 items-center justify-center rounded-lg transition ${active && hideTriggerWhileActive ? 'hidden' : 'flex'} ${
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
        // T-02 rev2 (was T-57's full-screen fixed bar): the recorder now overlays
        // ONLY the composer's tool row — anchored to the bordered wrapper, which
        // is position:relative — so the textarea above stays visible while T-01
        // streams the live transcript into it. Discard · ●+timer · waveform ·
        // insert, driven by the tick above.
        <div
          role="group"
          aria-label="Voice recording"
          className="visible absolute inset-x-0 bottom-0 z-10 rounded-b-2xl border-t border-border bg-surface px-2 py-1"
        >
          <div className="flex w-full items-center gap-3">
            <button
              type="button"
              onClick={() => { controller().cancel(); onCancel?.(); }}
              aria-label="Discard recording"
              title="Discard"
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-red-500/10 hover:text-red-300"
            >
              <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 4.5h10M6.4 4.5V3.6a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v.9M4.8 4.5l.4 8a1 1 0 0 0 1 .95h3.6a1 1 0 0 0 1-.95l.4-8" />
              </svg>
            </button>

            <span className="flex flex-shrink-0 items-center gap-2" aria-live="polite">
              <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
              <span className="font-mono text-[16px] tabular-nums text-ink" aria-label={`Recording ${mmss(snap.elapsedMs)}`}>{mmss(snap.elapsedMs)}</span>
            </span>

            {/* Activity animation only. Do NOT open a second getUserMedia stream
                here: Web Speech owns the microphone for this session. The old
                analyser could show live bars while starving recognition on some
                browser/device combinations. */}
            {/* T-108: a session that has heard NOTHING must say so instead of
                animating a fake waveform over silence — the host recorded into
                a mute recognizer for a full session with zero feedback. The
                hint reuses the waveform's flexible slot so the controls never
                move. */}
            {recording && !snap.hasHeardSpeech && snap.elapsedMs >= NO_SIGNAL_AFTER_MS ? (
              <span
                role="status"
                aria-live="polite"
                className="min-w-0 flex-1 truncate text-center text-[12px] font-semibold text-amber-300"
                title={noSignalMessage(snap)}
              >
                {noSignalMessage(snap)}
              </span>
            ) : (
            /* T-85 hotfix: min-w-0 lets the waveform shrink below its bars'
                min-content width - without it the flex row can never fit a
                narrow viewport and the Use-draft control gets pushed out. */
            <span className="flex h-8 min-w-0 flex-1 items-center justify-center gap-[3px] overflow-hidden" aria-hidden="true">
              {Array.from({ length: BARS }, (_, i) => {
                const amp = 11;
                const h = 3 + Math.abs(Math.sin(tick * 0.6 + i * 0.7)) * amp;
                return (
                  <span
                    key={i}
                    className="w-[3px] flex-shrink-0 rounded-full bg-red-400/80"
                    style={{ height: `${Math.min(30, h)}px` }}
                  />
                );
              })}
            </span>
            )}

            <button
              type="button"
              onClick={() => controller().stop()}
              aria-label="Use voice draft"
              title="Use draft (does not send the message)"
              className="flex h-11 flex-shrink-0 items-center justify-center gap-1.5 rounded-full bg-accent px-3 text-white transition hover:opacity-90"
            >
              <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m3 8.5 3.1 3.1L13 4.7" />
              </svg>
              <span className="text-sm font-semibold">Use draft</span>
            </button>
          </div>
          {/* No transcript preview here anymore: the live text streams into the
              textarea directly above (T-01), which stays visible now that this
              strip no longer covers the whole composer. */}
        </div>
      )}

      {!active && snap.error && (
        <div
          role="alert"
          className="fixed bottom-20 left-1/2 z-50 w-[min(92vw,34rem)] -translate-x-1/2 rounded-xl border border-red-400/40 bg-red-950 px-4 py-3 text-sm font-semibold text-red-100 shadow-2xl"
        >
          {snap.error}
        </div>
      )}
    </div>
  );
}
