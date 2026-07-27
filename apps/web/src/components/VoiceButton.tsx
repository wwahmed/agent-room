import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { DictationController, mergeTranscript, type DictationSnapshot, type RecognizerLike } from '../lib/dictation.js';
import {
  VoiceCaptureController,
  createIndexedDbStore,
  createMemoryStore,
  type RecorderLike,
  type SegmentStoreLike,
} from '../lib/voiceCapture.js';
import { playWarmingCue, playReadyCue, playSendCue, playCaughtUpCue } from '../lib/audioCue.js';
import { ScreenWakeLockController } from '../lib/screenWakeLock.js';

// A controller the button can drive uniformly, whether it is the built-in
// speech engine (DictationController) or the T-131 server-STT capture path
// (VoiceCaptureController). start() may be async for the capture path.
interface VoiceController {
  start(): void | Promise<void>;
  stop(): void;
  cancel(): void;
  snapshot(): DictationSnapshot;
}

// T-138: the composer pauses dictation imperatively when the user starts typing.
export interface VoiceButtonHandle { pause(): void }

// T-131: the capture path needs MediaRecorder + getUserMedia. Widely supported
// on desktop Chrome/Safari/Edge/Firefox, Chrome/Android, and Safari/iOS 14.3+.
const CAPTURE_SUPPORTED =
  typeof window !== 'undefined' &&
  typeof (window as { MediaRecorder?: unknown }).MediaRecorder === 'function' &&
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia;

// Prefer webm/opus (Android/desktop); Safari/iPhone only offers mp4/aac. The
// server decodes either with ffmpeg, so we just pick whatever the device says
// it can record.
function pickMimeType(): string | undefined {
  const MR = (window as unknown as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'];
  for (const c of candidates) if (MR?.isTypeSupported?.(c)) return c;
  return undefined;
}

// Wrap a native MediaRecorder as the controller's RecorderLike. Each stop()
// yields one complete, independently decodable segment.
function makeRecorder(stream: MediaStream): RecorderLike {
  const mimeType = pickMimeType();
  const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const rec: RecorderLike = { start: () => mr.start(), stop: () => mr.stop(), ondata: null, onstop: null, onerror: null };
  mr.ondataavailable = (e: BlobEvent) => { if (e.data && e.data.size > 0) rec.ondata?.(e.data); };
  mr.onstop = () => rec.onstop?.();
  mr.onerror = (e: Event) => rec.onerror?.(e);
  return rec;
}

// POST one segment to the server. MUST throw on any non-2xx or network error so
// the controller keeps the audio buffered locally and retries (never drops it).
async function postTranscribe(blob: Blob): Promise<{ text: string }> {
  const r = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'content-type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  if (!r.ok) {
    // 4xx (e.g. 422 bad_segment) is permanent for THIS clip; the controller
    // drops it and drains past. 5xx / network / 429 (rate limited) are
    // transient and get retried — a throttled segment must never be dropped.
    throw Object.assign(new Error(`transcribe ${r.status}`), { permanent: r.status >= 400 && r.status < 500 && r.status !== 429 });
  }
  const body = (await r.json()) as { text?: string };
  return { text: body?.text ?? '' };
}

function makeStore(): SegmentStoreLike {
  try {
    if (typeof indexedDB !== 'undefined') return createIndexedDbStore();
  } catch { /* private mode / disabled */ }
  return createMemoryStore();
}

interface Props {
  /** T-119: while dictation is active the recording overlay carries every
   *  control, so the trigger can yield its row slot to the draft text. */
  hideTriggerWhileActive?: boolean;
  /** Called once with the final transcript when the user Stops (accepts). */
  onTranscript: (text: string) => void;
  /** The overlay's accept control SENDS in one tap (Waqas: no two-stage
   *  use-draft-then-send). Called instead of onTranscript when the user taps
   *  Send — with the final transcript, AFTER any pending server-STT segments
   *  finish, so the composer can merge and dispatch the message itself. May be
   *  '' (e.g. base-only draft); the composer decides whether there is a body. */
  onSendTranscript?: (text: string) => void;
  /** T-59: called continuously while recording with the live (final+interim)
   *  transcript, so the words stream straight into the message box as they're
   *  spoken and nothing is ever lost if the session ends unexpectedly. */
  onLiveTranscript?: (text: string) => void;
  /** Fired when recording begins, so the composer can snapshot its base draft. */
  onStart?: () => void;
  /** Fired when the user discards (🗑), so the composer can revert to the base. */
  onCancel?: () => void;
  disabled?: boolean;
  /** T-138: the dictation is paused (the user typed); the trigger shows a
   *  distinct "resume" state, and tapping it resumes appending to the draft. */
  resumeMode?: boolean;
}

// The live transcript = committed words plus the not-yet-final interim tail.
function liveText(s: DictationSnapshot): string {
  return mergeTranscript(s.finalText, s.interim);
}

// Browser SpeechRecognition is non-standard; `any` avoids pulling a lib in for
// one component. null when unsupported (Firefox, older Safari) → render nothing.
// T-131 (reverts T-130's mobile gating): T-130 disabled the pause-restart on
// mobile to kill the OS beep, but that made the phone's engine STOP on the
// first silence — a P0 regression (Waqas: "now it just stops when there's a
// pause"). On the built-in engine you cannot have both "no beep" and "survives
// a pause": the engine ends on silence, and the only way to continue is to
// restart, which is the beep. Continuity wins over the occasional beep, so we
// always restart-on-pause; T-76's coalescing keeps the beep to the floor. The
// only path to silent AND continuous is capturing audio ourselves and
// transcribing server-side (see the silent-capture task), not this engine.
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

export const VoiceButton = forwardRef<VoiceButtonHandle, Props>(function VoiceButton(
  { onTranscript, onSendTranscript, onLiveTranscript, onStart, onCancel, disabled, hideTriggerWhileActive, resumeMode }: Props,
  ref,
) {
  const [snap, setSnap] = useState<DictationSnapshot>(IDLE);
  const [tick, setTick] = useState(0);
  const ctrlRef = useRef<VoiceController | null>(null);
  const wakeLockRef = useRef<ScreenWakeLockController | null>(null);
  // T-138: the composer pauses dictation imperatively the instant the user
  // types. Pause is a SILENT teardown to idle (drops the sub-second
  // untranscribed tail, no finalize, no revert); the composer keeps the draft,
  // and tapping the (now amber) trigger resumes with a fresh start() that
  // re-anchors to the current draft — so new speech appends without duplicating.
  useImperativeHandle(ref, () => ({ pause: () => ctrlRef.current?.cancel() }), []);
  // T-131: whether the local server-STT engine is reachable. Checked once on
  // mount; when true we use the silent, continuous capture path, otherwise we
  // fall back to the built-in speech engine.
  const engineOkRef = useRef(false);

  // The controller is created once; keep the latest callbacks in refs so its
  // long-lived onChange/onFinalize always call the current handlers.
  const onTranscriptRef = useRef(onTranscript);
  const onSendRef = useRef(onSendTranscript);
  const onLiveRef = useRef(onLiveTranscript);
  onTranscriptRef.current = onTranscript;
  onSendRef.current = onSendTranscript;
  onLiveRef.current = onLiveTranscript;
  // Whether the session was ended by the overlay's Send control. Routes the
  // (possibly async — server-STT segments may still be draining) finalize to
  // onSendTranscript instead of the insert-only onTranscript.
  const sendOnStopRef = useRef(false);
  // Caught-up indicator (Waqas): a visible ✓ plus ONE soft tick when the
  // transcript has caught up with speech, so he knows it's safe to send. The
  // snapshot's caughtUp must HOLD briefly before showing: the built-in
  // engine's finals clear the interim buffer for a beat mid-speech, and a
  // flickering ✓ (or a tick per flicker) is noise. The tick re-arms only
  // after caught-up drops again (new speech in flight), so a long silence
  // ticks once, not once per hold window.
  const [caughtUpShown, setCaughtUpShown] = useState(false);
  const caughtUpSinceRef = useRef<number | null>(null);
  const caughtUpTickedRef = useRef(false);
  // Composite meter fill (0..1): how far transcription has caught up with
  // speech, eased for display. Endpoints are exact — 1 only via the honest
  // caughtUp signal — while the middle is animation over pending-upload /
  // interim pressure, so the sweep reads as continuous progress.
  const [catchup, setCatchup] = useState(0);
  const catchupRef = useRef(0);
  // T-25 (host): a Send tapped mid-catch-up must ACKNOWLEDGE instantly — the
  // stop→drain→finalize pipeline can take seconds, and a button that sits
  // inert reads as broken. The tap flips this synchronously; the button shows
  // a spinner until the session finalizes and the composer's send fires.
  const [sendPending, setSendPending] = useState(false);

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
    if (!active) {
      // Session over: never carry a stale ✓ (or a spent tick arm) into the next one.
      setCaughtUpShown(false);
      caughtUpSinceRef.current = null;
      caughtUpTickedRef.current = false;
      catchupRef.current = 0;
      setCatchup(0);
      setSendPending(false); // the held Send resolved (or the session died)
      return;
    }
    const id = window.setInterval(() => {
      const c = ctrlRef.current;
      const s = c ? c.snapshot() : null;
      if (s) setSnap(s);
      // Meter target: full only on the honest caught-up signal; while words
      // are in flight, hover partway — deeper the more segments are queued —
      // so the fill visibly chases the speech.
      const target = s?.caughtUp
        ? 1
        : s?.state !== 'recording'
          ? catchupRef.current
          : Math.max(0.12, 0.72 - 0.22 * ((s.pendingUploads ?? 0) + (s.interim ? 1 : 0)));
      catchupRef.current += (target - catchupRef.current) * 0.18;
      if (Math.abs(target - catchupRef.current) < 0.01) catchupRef.current = target;
      setCatchup(catchupRef.current);
      if (s?.caughtUp) {
        const now = Date.now();
        if (caughtUpSinceRef.current === null) caughtUpSinceRef.current = now;
        if (now - caughtUpSinceRef.current >= 600) {
          setCaughtUpShown(true);
          if (!caughtUpTickedRef.current) {
            caughtUpTickedRef.current = true;
            playCaughtUpCue();
          }
        }
      } else {
        caughtUpSinceRef.current = null;
        caughtUpTickedRef.current = false;
        setCaughtUpShown(false);
      }
      setTick(t => t + 1);
    }, 200);
    return () => window.clearInterval(id);
  }, [active]);

  // Abort any in-flight session if the composer unmounts (accidental navigation).
  useEffect(() => () => { ctrlRef.current?.cancel(); }, []);

  // T-131: probe the local STT engine once so start() can choose the capture path.
  useEffect(() => {
    if (!CAPTURE_SUPPORTED) return;
    let alive = true;
    fetch('/api/transcribe/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.ok) engineOkRef.current = true; })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Render if EITHER path is available — capture works even where the built-in
  // SpeechRecognition does not (e.g. Firefox).
  if (!SpeechRecognitionImpl && !CAPTURE_SUPPORTED) return null;

  const onChange = (s: DictationSnapshot) => { setSnap(s); if (s.state !== 'idle') onLiveRef.current?.(liveText(s)); };
  const onFinalize = (text: string) => {
    if (sendOnStopRef.current && onSendRef.current) {
      // Even an empty transcript goes through: the composer may hold a typed
      // base draft the user expects this Send to dispatch.
      sendOnStopRef.current = false;
      onSendRef.current(text);
      return;
    }
    sendOnStopRef.current = false;
    if (text) onTranscriptRef.current?.(text);
  };

  // Built fresh at each start so a late engine probe is honored on the next
  // session, not frozen to what was known at first click. Prefer the silent
  // capture path when the engine is reachable (or when there is no built-in
  // engine to fall back to); otherwise the built-in speech engine.
  function buildController(): VoiceController {
    const useCapture = CAPTURE_SUPPORTED && (engineOkRef.current || !SpeechRecognitionImpl);
    if (useCapture) {
      return new VoiceCaptureController({
        getStream: () => navigator.mediaDevices.getUserMedia({ audio: true }),
        createRecorder: (stream) => makeRecorder(stream as MediaStream),
        transcribe: postTranscribe,
        store: makeStore(),
        onChange,
        onFinalize,
      });
    }
    return new DictationController({
      createRecognizer: () => new SpeechRecognitionImpl() as RecognizerLike,
      lang: navigator.language || undefined,
      // The built-in engine restarts on a pause to stay continuous (T-131
      // revert); the capture path above avoids the OS beep entirely instead.
      restartOnPause: true,
      onChange,
      onFinalize,
    });
  }

  return (
    <div className="flex-shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (active) { playSendCue(); ctrlRef.current?.stop(); return; }
          sendOnStopRef.current = false; // a new session never inherits a Send intent
          onStart?.(); // snapshot the composer's base draft before words stream in
          const c = buildController();
          ctrlRef.current = c;
          // Responsive two-phase start (Waqas): faint warming-up dots the
          // instant you tap, then a solid "recording now" tone once the
          // recorder is actually live (start() resolved). A single "send" tone
          // on stop. Silent in between.
          playWarmingCue();
          void Promise.resolve(c.start()).then(() => playReadyCue()).catch(() => {});
        }}
        aria-label={active ? 'Stop dictation and insert text' : resumeMode ? 'Resume dictation' : 'Start voice dictation'}
        title={active ? 'Stop dictation' : resumeMode ? 'Resume dictation (paused)' : 'Start voice dictation'}
        aria-pressed={active}
        data-gate={resumeMode && !active ? 'dictation-paused' : undefined}
        className={`text-base leading-none w-11 h-11 items-center justify-center rounded-lg transition ${active && hideTriggerWhileActive ? 'hidden' : 'flex'} ${
          recording
            ? 'bg-red-500/20 text-red-300'
            : snap.state === 'paused' || (resumeMode && !active)
            ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/50'
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
              onClick={() => { sendOnStopRef.current = false; ctrlRef.current?.cancel(); onCancel?.(); }}
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
            {snap.offline && (snap.pendingUploads ?? 0) > 0 ? (
              // T-131: the server/network dropped, but audio is safe in the
              // local buffer and will transcribe on reconnect. Say so, so the
              // user trusts nothing was lost.
              <span
                role="status"
                aria-live="polite"
                className="min-w-0 flex-1 truncate text-center text-[12px] font-semibold text-amber-300"
                title="Saved locally, will transcribe when reconnected"
              >
                Saved locally · {snap.pendingUploads} clip{(snap.pendingUploads ?? 0) === 1 ? '' : 's'} will transcribe when reconnected
              </span>
            ) : (snap.droppedSegments ?? 0) > 0 ? (
              // T-131: a poison segment was abandoned so the rest could drain.
              // Say so rather than silently dropping words.
              <span
                role="status"
                aria-live="polite"
                className="min-w-0 flex-1 truncate text-center text-[12px] font-semibold text-amber-300"
                title="Some audio could not be transcribed"
              >
                {snap.droppedSegments} clip{(snap.droppedSegments ?? 0) === 1 ? '' : 's'} could not be transcribed
              </span>
            ) : recording && !snap.hasHeardSpeech && snap.elapsedMs >= NO_SIGNAL_AFTER_MS ? (
              <span
                role="status"
                aria-live="polite"
                className="min-w-0 flex-1 truncate text-center text-[12px] font-semibold text-amber-300"
                title={noSignalMessage(snap)}
              >
                {noSignalMessage(snap)}
              </span>
            ) : (
            /* Composite recording + catch-up meter (host brief: ONE visual, no
               narration). The strip is both the live-activity waveform AND the
               transcription progress track: bars fill emerald from the left as
               transcription catches up with speech, stay hot red where words
               are still in flight, and the whole strip settles into a calm
               green breathing motion when everything said is transcribed —
               that settle (plus the Send button lighting up) IS "safe to
               send". Endpoints are exact (full ⇔ the honest caughtUp signal);
               the middle of the sweep is eased animation over pending-upload /
               interim pressure. T-85's min-w-0 flex rule preserved. */
            <span
              role="status"
              data-gate="catchup-meter"
              aria-label={caughtUpShown ? 'Transcript caught up — safe to send' : 'Transcribing…'}
              title={caughtUpShown ? 'Everything you said is in the transcript — safe to send' : 'Filling as transcription catches up with your speech'}
              className="flex h-8 min-w-0 flex-1 items-center justify-center gap-[3px] overflow-hidden"
            >
              {Array.from({ length: BARS }, (_, i) => {
                const done = (i + 1) / BARS <= catchup + 0.001;
                // Settled: low, slow, green breathing. Transcribed: calmer
                // green motion. In flight: the original hot red waveform.
                const amp = caughtUpShown ? 3.5 : done ? 6 : 11;
                const speed = caughtUpShown ? 0.22 : 0.6;
                const h = 3 + Math.abs(Math.sin(tick * speed + i * 0.7)) * amp;
                return (
                  <span
                    key={i}
                    className={`w-[3px] flex-shrink-0 rounded-full transition-colors duration-300 ${done ? 'bg-emerald-400/90' : 'bg-red-400/80'}`}
                    style={{ height: `${Math.min(30, h)}px` }}
                  />
                );
              })}
            </span>
            )}

            {/* One-tap finish (Waqas): the old two-stage Use-draft-then-Send
                collapses into a single Send — stop, finalize, dispatch. The
                live transcript already streams into the textarea above, so
                anyone who wants to edit first just taps the text and types
                (T-138 pauses dictation), then uses the composer's own Send. */}
            <button
              type="button"
              data-gate="voice-send"
              disabled={sendPending}
              onClick={() => {
                // T-25: acknowledge the tap SYNCHRONOUSLY — the visual flip
                // happens before the stop/drain pipeline starts, so a Send
                // during catch-up never reads as a dead button.
                setSendPending(true);
                if (onSendTranscript) {
                  // No cue here: the composer's send path plays the send
                  // chime once the message actually dispatches — one tap,
                  // one cue.
                  sendOnStopRef.current = true;
                  ctrlRef.current?.stop();
                  return;
                }
                playSendCue();
                ctrlRef.current?.stop();
              }}
              aria-label={sendPending ? 'Finishing the transcript — your message will send itself' : onSendTranscript ? 'Send message' : 'Use voice draft'}
              title={sendPending ? 'Finishing the transcript — sends automatically' : onSendTranscript ? 'Send' : 'Use draft (does not send the message)'}
              // The action itself signals readiness: when the transcript has
              // caught up, Send lights up green — the second half of the
              // composite meter's "safe to send", still with zero words.
              className={`flex h-11 flex-shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-white transition hover:opacity-90 disabled:opacity-90 ${
                sendPending ? 'bg-emerald-700' : caughtUpShown ? 'bg-emerald-600 ring-2 ring-emerald-400/50' : 'bg-accent'
              }`}
            >
              {sendPending ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none" aria-hidden="true" />
              ) : onSendTranscript ? (
                <svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor" aria-hidden="true">
                  <path d="M1.7 7.3 13.6 2a.6.6 0 0 1 .8.8L9.1 14.7a.6.6 0 0 1-1.1 0L6.2 10.5a.6.6 0 0 0-.3-.3L1.7 8.4a.6.6 0 0 1 0-1.1Z" transform="rotate(-8 8 8)" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m3 8.5 3.1 3.1L13 4.7" />
                </svg>
              )}
              <span className="text-sm font-semibold">{sendPending ? 'Sending…' : onSendTranscript ? 'Send' : 'Use draft'}</span>
            </button>
          </div>
          {/* T-25 (host): an EXPLICIT progress track under the audio indicator
              — the waveform's color sweep reads as ambience; this bar answers
              "how much of what I said is in the transcript yet" at a glance.
              Endpoints stay honest: 100% only via the real caughtUp signal. */}
          <div
            data-gate="catchup-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(catchup * 100)}
            aria-label="Transcription catch-up"
            title={caughtUpShown ? 'Transcript caught up — safe to send' : `Transcription ${Math.round(catchup * 100)}% caught up with your speech`}
            className="mx-1 mb-0.5 mt-1 h-1 overflow-hidden rounded-full bg-surface-softer"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-200 ${caughtUpShown ? 'bg-emerald-400' : 'bg-amber-400'}`}
              style={{ width: `${Math.max(3, Math.round(catchup * 100))}%` }}
            />
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
});
