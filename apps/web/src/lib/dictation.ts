// T-40: a real dictation state machine, split from the SpeechRecognition DOM
// binding so the reliability behavior (short-pause tolerance, preserve text
// across pauses, finalize only on Stop, restart backoff, safety limit) is
// unit-testable with a fake recognizer + injectable clock.
//
// The old VoiceButton set continuous=false and delivered text on `onend`, so a
// brief pause ended the session and dumped partial text into the composer.
// Here, an `onend` while still recording is treated as a pause to auto-recover
// from (re-start the recognizer), NOT as the end of dictation — only an explicit
// Stop (or the hard safety limit) finalizes and delivers.

export type DictationState = 'idle' | 'recording' | 'paused';

export interface DictationSnapshot {
  state: DictationState;
  /** committed text so far (survives pauses/restarts) */
  finalText: string;
  /** current not-yet-final words being recognized */
  interim: string;
  /** active recording time in ms, excluding paused time */
  elapsedMs: number;
  error: string | null;
}

// Minimal shape of the browser SpeechRecognition we depend on.
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
  onFinalize: (text: string) => void; // called on Stop or safety-limit only
  lang?: string;
  maxMs?: number; // hard safety limit; default 5 min
  restartBackoffMs?: number; // delay before auto-restart after an end while recording
  now?: () => number; // injectable clock (default Date.now)
  setTimer?: (fn: () => void, ms: number) => unknown; // injectable (default setTimeout)
  clearTimer?: (id: unknown) => void;
}

const DEFAULT_MAX_MS = 5 * 60 * 1000;

// SpeechRecognition errors that mean "stop, the user must act" vs. transient.
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

export class DictationController {
  private state: DictationState = 'idle';
  private finalText = '';
  private interim = '';
  private error: string | null = null;

  private rec: RecognizerLike | null = null;
  private stopping = false; // an explicit Stop is in flight (deliver on next end)
  private cancelling = false;
  private restartTimer: unknown = null;

  // timing (active time only)
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
      now: opts.now ?? (() => Date.now()),
      setTimer: opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown),
      clearTimer: opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>)),
    };
  }

  snapshot(): DictationSnapshot {
    return {
      state: this.state,
      // committed text + the current session's finalized-but-not-yet-committed
      // words, so the display reflects everything recognized so far.
      finalText: (this.finalText + this.liveFinal).trim(),
      interim: this.interim,
      elapsedMs: this.elapsed(),
      error: this.error,
    };
  }

  private elapsed(): number {
    return this.activeMs + (this.state === 'recording' ? this.o.now() - this.segmentStart : 0);
  }

  private emit() { this.o.onChange(this.snapshot()); }

  private spawn() {
    const rec = this.o.createRecognizer();
    rec.continuous = true;
    rec.interimResults = true;
    if (this.o.lang) rec.lang = this.o.lang;

    rec.onresult = (e) => {
      // Rebuild this session's final + interim from the cumulative results.
      let sessionFinal = '';
      let sessionInterim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        if (r.isFinal) sessionFinal += r[0].transcript;
        else sessionInterim += r[0].transcript;
      }
      this.liveFinal = sessionFinal;
      this.interim = sessionInterim;
      if (this.elapsed() >= this.o.maxMs) { this.stop(); return; } // safety limit
      this.emit();
    };
    rec.onerror = (e) => {
      const err = e?.error ?? 'unknown';
      if (FATAL_ERRORS.has(err)) {
        this.error = err === 'not-allowed' || err === 'service-not-allowed'
          ? 'Microphone access was blocked. Enable mic permission to dictate.'
          : 'No microphone available.';
        this.hardReset('idle');
        this.emit();
      }
      // transient ('no-speech','network','aborted') → handled by onend/restart
    };
    rec.onend = () => {
      // commit whatever this recognizer finalized before it ended
      this.commitLive();
      if (this.cancelling) { this.cancelling = false; return; }
      if (this.stopping) { this.finish(); return; }
      if (this.state === 'recording') {
        // Premature end (a pause, silence, or transient hiccup) — keep going.
        if (this.elapsed() >= this.o.maxMs) { this.finish(); return; }
        this.scheduleRestart();
      }
    };

    this.rec = rec;
    try { rec.start(); } catch { /* start() can throw if called too fast */ }
  }

  private liveFinal = '';
  private commitLive() {
    if (this.liveFinal) { this.finalText += this.liveFinal; this.liveFinal = ''; }
    // interim is intentionally kept for display until a new session overwrites it
  }

  private scheduleRestart() {
    if (this.restartTimer) return;
    this.restartTimer = this.o.setTimer(() => {
      this.restartTimer = null;
      if (this.state === 'recording' && !this.stopping && !this.cancelling) this.spawn();
    }, this.o.restartBackoffMs);
  }

  private clearRestart() {
    if (this.restartTimer) { this.o.clearTimer(this.restartTimer); this.restartTimer = null; }
  }

  // ---- public controls ----

  start() {
    if (this.state !== 'idle') return;
    this.finalText = '';
    this.interim = '';
    this.liveFinal = '';
    this.error = null;
    this.activeMs = 0;
    this.segmentStart = this.o.now();
    this.stopping = false;
    this.cancelling = false;
    this.state = 'recording';
    this.spawn();
    this.emit();
  }

  pause() {
    if (this.state !== 'recording') return;
    this.commitLive();
    this.activeMs += this.o.now() - this.segmentStart;
    this.state = 'paused';
    this.clearRestart();
    // abort() (not stop()) so this end doesn't finalize; text is already committed.
    this.cancelling = true; // suppress restart/finish on the resulting onend
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.rec = null;
    this.emit();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'recording';
    this.segmentStart = this.o.now();
    this.cancelling = false;
    this.stopping = false;
    this.spawn();
    this.emit();
  }

  stop() {
    if (this.state === 'idle') return;
    // include the current interim so trailing words aren't lost
    if (this.state === 'recording') this.activeMs += this.o.now() - this.segmentStart;
    this.commitLive();
    this.clearRestart();
    if (this.state === 'paused' || !this.rec) { this.finish(); return; }
    this.stopping = true;
    try { this.rec.stop(); } catch { this.finish(); }
  }

  cancel() {
    if (this.state === 'idle') return;
    this.cancelling = true;
    this.clearRestart();
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.hardReset('idle');
    this.emit();
  }

  private finish() {
    const text = (this.finalText + (this.interim ? ` ${this.interim}` : '')).replace(/\s+/g, ' ').trim();
    this.hardReset('idle');
    this.emit();
    if (text) this.o.onFinalize(text);
  }

  private hardReset(state: DictationState) {
    this.state = state;
    this.finalText = '';
    this.interim = '';
    this.liveFinal = '';
    this.stopping = false;
    this.cancelling = false;
    this.rec = null;
    this.clearRestart();
  }
}
