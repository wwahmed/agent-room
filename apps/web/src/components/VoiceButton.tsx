import { useEffect, useRef, useState } from 'react';
import { DictationController, type DictationSnapshot, type RecognizerLike } from '../lib/dictation.js';

interface Props {
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
  return (s.finalText + (s.interim ? ` ${s.interim}` : '')).trim();
}

// Browser SpeechRecognition is non-standard; `any` avoids pulling a lib in for
// one component. null when unsupported (Firefox, older Safari) → render nothing.
const SpeechRecognitionImpl: any =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

function mmss(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const IDLE: DictationSnapshot = { state: 'idle', finalText: '', interim: '', elapsedMs: 0, error: null };
const BARS = 22;

// Truthful mic-level meter: taps the real input via getUserMedia + an
// AnalyserNode and returns a 0..1 RMS level while `active`. If the mic can't be
// tapped it stays 0 — the waveform then rides a gentle synthetic idle so the
// bar still visibly signals "recording".
function useMicLevel(active: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active) { setLevel(0); return; }
    const AC: typeof AudioContext | undefined =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
      if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s;
      ctx = new AC();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(s).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = ((data[i] ?? 128) - 128) / 128; sum += v * v; }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.2));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }).catch(() => { /* no level available; synthetic idle animation carries the waveform */ });
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
      ctx?.close().catch(() => {});
    };
  }, [active]);
  return level;
}

export function VoiceButton({ onTranscript, onLiveTranscript, onStart, onCancel, disabled }: Props) {
  const [snap, setSnap] = useState<DictationSnapshot>(IDLE);
  const [tick, setTick] = useState(0);
  const ctrlRef = useRef<DictationController | null>(null);
  const level = useMicLevel(snap.state === 'recording');

  // The controller is created once; keep the latest callbacks in refs so its
  // long-lived onChange/onFinalize always call the current handlers.
  const onTranscriptRef = useRef(onTranscript);
  const onLiveRef = useRef(onLiveTranscript);
  onTranscriptRef.current = onTranscript;
  onLiveRef.current = onLiveTranscript;

  const recording = snap.state === 'recording';
  const active = snap.state !== 'idle';

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
        // T-59: stream every update into the composer as it's spoken (not just at
        // the end), so a dropped final event can never swallow what was said.
        onChange: (s) => { setSnap(s); if (s.state !== 'idle') onLiveRef.current?.(liveText(s)); },
        onFinalize: (text) => { if (text) onTranscriptRef.current?.(text); },
      });
    }
    return ctrlRef.current;
  }

  const preview = (snap.finalText + ' ' + snap.interim).trim();

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
        // T-57 (host: "recording strip so small and doesn't work"): a full-width
        // recording bar pinned to the bottom, replacing the composer while
        // active — big discard · live ●+timer · animated waveform · big send,
        // WhatsApp-style. Timer + waveform driven by the tick above.
        <div
          role="group"
          aria-label="Voice recording"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface px-3 pt-3 shadow-2xl"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto flex w-full max-w-[860px] items-center gap-3">
            <button
              type="button"
              onClick={() => { controller().cancel(); onCancel?.(); }}
              aria-label="Discard recording"
              title="Discard"
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-red-500/10 hover:text-red-300"
            >
              <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 4.5h10M6.4 4.5V3.6a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v.9M4.8 4.5l.4 8a1 1 0 0 0 1 .95h3.6a1 1 0 0 0 1-.95l.4-8" />
              </svg>
            </button>

            <span className="flex flex-shrink-0 items-center gap-2" aria-live="polite">
              <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
              <span className="font-mono text-[16px] tabular-nums text-ink" aria-label={`Recording ${mmss(snap.elapsedMs)}`}>{mmss(snap.elapsedMs)}</span>
            </span>

            {/* live waveform: real mic level drives amplitude; a gentle synthetic
                sine keeps the bars moving even when the mic can't be tapped */}
            <span className="flex h-8 flex-1 items-center justify-center gap-[3px] overflow-hidden" aria-hidden="true">
              {Array.from({ length: BARS }, (_, i) => {
                const amp = 4 + level * 26;
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

            <button
              type="button"
              onClick={() => controller().stop()}
              aria-label="Send transcript to the message box"
              title="Insert transcript"
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:opacity-90"
            >
              <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true">
                <path d="M2 7.4 13.2 2.6a.5.5 0 0 1 .66.64L9.3 14.2a.5.5 0 0 1-.94-.02L7 9.6 2.02 8.35a.5.5 0 0 1-.02-.95Z" />
              </svg>
            </button>
          </div>

          {(preview || snap.error) && (
            <div className="mx-auto mt-2 w-full max-w-[860px] px-1">
              {snap.error ? (
                <span className="text-[12px] font-semibold text-red-300">{snap.error}</span>
              ) : (
                <span className="line-clamp-2 text-[13px] text-ink-soft">{preview}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
