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

// Truthful mic-level meter: taps the real input via getUserMedia + an
// AnalyserNode and returns a 0..1 RMS level while `active`. If the mic can't be
// tapped (denied, or a browser that won't share it alongside SpeechRecognition)
// it stays 0 — the pulsing dot + timer still signal recording; we don't fake it.
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
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3)); // speech RMS ~0.05–0.3
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }).catch(() => { /* no level available; dot + timer still indicate recording */ });
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
      ctx?.close().catch(() => {});
    };
  }, [active]);
  return level;
}

export function VoiceButton({ onTranscript, disabled }: Props) {
  const [snap, setSnap] = useState<DictationSnapshot>(IDLE);
  const ctrlRef = useRef<DictationController | null>(null);
  // hooks must run before the early return; `active` gates the mic tap.
  const level = useMicLevel(snap.state === 'recording');

  // Abort any in-flight session if the composer unmounts (accidental navigation).
  useEffect(() => () => { ctrlRef.current?.cancel(); }, []);

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

  const active = snap.state !== 'idle';
  const recording = snap.state === 'recording';

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
        // Compact WhatsApp/Teams-style recorder: a slim inline pill above the
        // composer — discard · live dot+timer · waveform · send. No Pause
        // (short silences are tolerated under the hood, not by a button).
        <div
          role="group"
          aria-label="Voice recording"
          className="absolute bottom-full left-0 z-30 mb-2 flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1.5 pr-1 shadow-lg"
        >
          <button
            type="button"
            onClick={() => controller().cancel()}
            aria-label="Discard recording"
            title="Discard"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-red-500/10 hover:text-red-300"
          >
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 4.5h10M6.4 4.5V3.6a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v.9M4.8 4.5l.4 8a1 1 0 0 0 1 .95h3.6a1 1 0 0 0 1-.95l.4-8" />
            </svg>
          </button>

          <span className="flex items-center gap-1.5" aria-live="polite">
            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-400 animate-pulse" aria-hidden="true" />
            <span className="font-mono text-[12px] tabular-nums text-ink" aria-label={`Recording ${mmss(snap.elapsedMs)}`}>{mmss(snap.elapsedMs)}</span>
          </span>

          {/* real mic level (0..1) drives the waveform; flat if the mic can't be tapped */}
          <span className="flex h-4 items-center gap-0.5" aria-hidden="true">
            {[0.5, 0.85, 1, 0.7, 0.9, 0.6].map((w, i) => (
              <span
                key={i}
                className="w-0.5 rounded-full bg-red-400/70 transition-[height] duration-75"
                style={{ height: `${Math.max(3, Math.min(15, 3 + level * w * 15))}px` }}
              />
            ))}
          </span>

          {snap.error && <span className="max-w-[130px] truncate text-[10px] font-semibold text-red-300">{snap.error}</span>}

          <button
            type="button"
            onClick={() => controller().stop()}
            aria-label="Send transcript to the message box"
            title="Insert transcript"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:opacity-90"
          >
            <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
              <path d="M2 7.4 13.2 2.6a.5.5 0 0 1 .66.64L9.3 14.2a.5.5 0 0 1-.94-.02L7 9.6 2.02 8.35a.5.5 0 0 1-.02-.95Z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
