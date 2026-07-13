// T-40: a real dictation state machine, split from the SpeechRecognition DOM
// binding so the reliability behavior is unit-testable with a fake recognizer +
// injectable clock/timers.
//
// The old VoiceButton set continuous=false and delivered text on `onend`, so a
// brief pause ended the session and dumped partial text into the composer. Here
// an `onend` while still recording is a pause to auto-recover from (restart),
// NOT the end — only an explicit Stop (or a pause-aware hard deadline) finalizes.

export type DictationState = 'idle' | 'recording' | 'paused';

export interface DictationSnapshot {
  state: DictationState;
  finalText: string; // committed text (survives pauses/restarts)
  interim: string;   // current not-yet-final words
  elapsedMs: number; // active recording time, excluding paused time
  error: string | null;
}

export interface RecognizerLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

export interface DictationOptions {
  createRecognizer: () => RecognizerLike;
  onChange: (snapshot: DictationSnapshot) => void;
  onFinalize: (text: string) => void; // Stop or hard-deadline only
  lang?: string;
  maxMs?: number;
  restartBackoffMs?: number;
  maxConsecutiveStartFailures?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

const DEFAULT_MAX_MS = 5 * 60 * 1000;
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

export class DictationController {
  private state: DictationState = 'idle';
  private finalText = '';
  private liveFinal = '';
  private interim = '';
  private error: string | null = null;

  private rec: RecognizerLike | null = null; // the CURRENT recognizer; events from any other are stale
  private stopping = false;
  private restartTimer: unknown = null;
  private deadlineTimer: unknown = null;
  private startFailures = 0;

  private activeMs = 0;
  private segmentStart = 0;

  private readonly o: Required<Omit<DictationOptions, 'lang'>> & { lang?: string };

  constructor(opts: DictationOptions) {
    this.o = {
      createRecognizer: opts.createRecognizer,
      onChange: opts.onChange,
      onFinalize: opts.onFinalize,
      lang: opts.lang,
      maxMs: opts.maxMs ?? DEFAULT_MAX_MS,
      restartBackoffMs: opts.restartBackoffMs ?? 250,
      maxConsecutiveStartFailures: opts.maxConsecutiveStartFailures ?? 3,
      now: opts.now ?? (() => Date.now()),
      setTimer: opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown),
      clearTimer: opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>)),
    };
  }

  snapshot(): DictationSnapshot {
    return {
      state: this.state,
      finalText: DictationController.join(this.finalText, this.liveFinal).trim(),
      interim: this.interim,
      elapsedMs: this.elapsed(),
      error: this.error,
    };
  }

  private elapsed(): number {
    return this.activeMs + (this.state === 'recording' ? this.o.now() - this.segmentStart : 0);
  }
  private emit() { this.o.onChange(this.snapshot()); }

  private spawn(initial: boolean) {
    const rec = this.o.createRecognizer();
    rec.continuous = true;
    rec.interimResults = true;
    if (this.o.lang) rec.lang = this.o.lang;

    // Generation guard: only the CURRENT recognizer's events mutate state, so a
    // delayed event from a replaced/aborted recognizer can't corrupt the session.
    const isCurrent = () => this.rec === rec;

    rec.onresult = (e) => {
      if (!isCurrent()) return;
      let sf = '';
      let si = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        if (r.isFinal) sf += r[0].transcript;
        else si += r[0].transcript;
      }
      this.liveFinal = sf;
      this.interim = si;
      this.emit();
    };
    rec.onerror = (e) => {
      if (!isCurrent()) return;
      const err = e?.error ?? 'unknown';
      if (FATAL_ERRORS.has(err)) {
        this.error = err === 'audio-capture'
          ? 'No microphone available.'
          : 'Microphone access was blocked. Enable mic permission to dictate.';
        this.clearRestart();
        this.clearDeadline();
        this.hardReset('idle');
        this.emit();
      }
      // transient (no-speech/network/aborted) → handled by onend
    };
    rec.onend = () => {
      if (!isCurrent()) return;
      this.commitLive();
      if (this.stopping) { this.finish(); return; }
      if (this.state === 'recording') {
        // premature end (pause/silence/hiccup) — keep going, don't finalize
        this.rec = null; // ignore any further late events from this recognizer
        this.scheduleRestart();
      }
    };

    this.rec = rec;
    try {
      rec.start();
      this.startFailures = 0;
    } catch {
      // Synchronous start() failure must NOT leave a false "Recording" state.
      this.rec = null;
      this.startFailures++;
      if (initial || this.startFailures > this.o.maxConsecutiveStartFailures) {
        this.error = 'Could not start the microphone. Close other apps using it and retry.';
        this.clearDeadline();
        this.hardReset('idle');
        this.emit();
      } else if (this.state === 'recording') {
        this.scheduleRestart();
      }
    }
  }

  // Join two text runs with exactly one separating space when neither side
  // already provides whitespace (browsers are inconsistent about trailing
  // spaces on final results).
  private static join(a: string, b: string): string {
    if (!a) return b;
    if (!b) return a;
    return /\s$/.test(a) || /^\s/.test(b) ? a + b : `${a} ${b}`;
  }
  private commitLive() {
    if (this.liveFinal) { this.finalText = DictationController.join(this.finalText, this.liveFinal); this.liveFinal = ''; }
  }

  private scheduleRestart() {
    if (this.restartTimer != null) return;
    this.restartTimer = this.o.setTimer(() => {
      this.restartTimer = null;
      if (this.state === 'recording' && !this.stopping) this.spawn(false);
    }, this.o.restartBackoffMs);
  }
  private clearRestart() {
    if (this.restartTimer != null) { this.o.clearTimer(this.restartTimer); this.restartTimer = null; }
  }

  // Pause-aware hard deadline: fires Stop when ACTIVE time reaches maxMs even
  // during total silence (no recognizer events). Rescheduled on resume.
  private scheduleDeadline() {
    this.clearDeadline();
    const remaining = this.o.maxMs - this.elapsed();
    if (remaining <= 0) { this.stop(); return; }
    this.deadlineTimer = this.o.setTimer(() => { this.deadlineTimer = null; this.stop(); }, remaining);
  }
  private clearDeadline() {
    if (this.deadlineTimer != null) { this.o.clearTimer(this.deadlineTimer); this.deadlineTimer = null; }
  }

  // ---- public controls ----

  start() {
    if (this.state !== 'idle') return;
    this.finalText = ''; this.liveFinal = ''; this.interim = '';
    this.error = null; this.activeMs = 0; this.stopping = false; this.startFailures = 0;
    this.segmentStart = this.o.now();
    this.state = 'recording';
    this.scheduleDeadline();
    this.spawn(true);
    if (this.state === 'recording') this.emit(); // spawn may have failed → already idle+emitted
  }

  pause() {
    if (this.state !== 'recording') return;
    // preserve BOTH finalized and interim words spoken before the pause
    this.commitLive();
    if (this.interim) { this.finalText = DictationController.join(this.finalText, this.interim); this.interim = ''; }
    this.activeMs += this.o.now() - this.segmentStart;
    this.state = 'paused';
    this.clearRestart();
    this.clearDeadline();
    const rec = this.rec; this.rec = null; // stale-guard: ignore this recognizer's later events
    try { rec?.abort(); } catch { /* ignore */ }
    this.emit();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'recording';
    this.segmentStart = this.o.now();
    this.stopping = false;
    this.scheduleDeadline();
    this.spawn(false);
    if (this.state === 'recording') this.emit();
  }

  stop() {
    if (this.state === 'idle') return;
    if (this.state === 'recording') this.activeMs += this.o.now() - this.segmentStart;
    this.commitLive();
    this.clearRestart();
    this.clearDeadline();
    const rec = this.rec;
    if (this.state === 'paused' || !rec) { this.finish(); return; }
    this.stopping = true;
    try { rec.stop(); } catch { this.finish(); }
  }

  cancel() {
    if (this.state === 'idle') return;
    this.clearRestart();
    this.clearDeadline();
    const rec = this.rec; this.rec = null;
    try { rec?.abort(); } catch { /* ignore */ }
    this.hardReset('idle');
    this.emit();
  }

  private finish() {
    const text = (this.finalText + (this.interim ? ` ${this.interim}` : '')).replace(/\s+/g, ' ').trim();
    this.clearRestart();
    this.clearDeadline();
    this.hardReset('idle');
    this.emit();
    if (text) this.o.onFinalize(text);
  }

  private hardReset(state: DictationState) {
    this.state = state;
    this.finalText = ''; this.liveFinal = ''; this.interim = '';
    this.stopping = false; this.rec = null;
  }
}
