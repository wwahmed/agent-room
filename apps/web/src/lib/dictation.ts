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
  // T-108 no-signal diagnostics: a session can sit in `recording` forever
  // while the browser's recognizer returns nothing (wrong mic input, mute
  // Siri/Google backend, silent restart loop). These let the UI say so.
  hasHeardSpeech: boolean;          // any onresult at all this session
  restarts: number;                 // automatic restarts this session
  lastTransientError: string | null; // most recent non-fatal error code
  // T-131 (server-STT capture path only): segments recorded locally but not yet
  // transcribed, and whether the last upload failed so the composer can show a
  // "saved locally, will transcribe when reconnected" state. Unset for the
  // built-in-engine DictationController.
  pendingUploads?: number;
  offline?: boolean;
  // Segments the server permanently rejected (undecodable audio) and gave up on.
  droppedSegments?: number;
  // Transcription has CAUGHT UP with speech: everything said so far is in the
  // transcript, so it's safe to eyeball-check and send. Capture path: the last
  // resolved segment contained no recognized speech (pending===0 alone is 0
  // most of the time even mid-sentence — segments cut every 2.5s — so it would
  // flicker). Built-in engine: heard speech and the interim buffer is empty.
  // Always false while offline / uploads pending / segments dropped.
  caughtUp?: boolean;
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
  onFinalize: (text: string) => void; // Stop or hard-deadline only; text may be ''
  lang?: string;
  maxMs?: number;
  restartBackoffMs?: number;
  // T-76: minimum spacing between recognizer (re)starts. On Android Chrome the
  // OS plays a "listening" beep on every SpeechRecognition start, and the
  // recognizer ends on natural pauses, so a per-onend restart beeps on every
  // pause and partial. Coalescing restarts to at most one per this interval
  // means the beep no longer fires on every pause — it stays near the genuine
  // start/stop. The OS beep itself is not JS-suppressible; this removes the
  // excess restarts that caused the repeated beeping.
  minRestartIntervalMs?: number;
  // T-130 (host ruling): whether to auto-restart the recognizer when it ends
  // prematurely (a pause/silence) while still recording. True (default) keeps
  // continuous dictation across pauses — correct on desktop, which has no OS
  // beep. FALSE means a premature end FINALIZES the draft instead of
  // restarting, so the mic session starts exactly once (one OS beep at start,
  // none mid-recording); used on the mobile platforms whose OS beeps on every
  // recognizer start. The committed draft is preserved either way.
  restartOnPause?: boolean;
  maxConsecutiveStartFailures?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

const DEFAULT_MAX_MS = 5 * 60 * 1000;
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network']);

/**
 * Merge a new recognition hypothesis into the transcript already shown.
 *
 * Chrome on Android can report progressive *cumulative* hypotheses as separate
 * results ("this", "this is", "this is a test") and can replay the same
 * cumulative phrase after an automatic recognizer restart. A plain append turns
 * that stream into "this this is this is a test". Prefer the longer cumulative
 * form and otherwise remove only a word-boundary suffix/prefix overlap.
 */
export function mergeTranscript(base: string, incoming: string): string {
  const left = base.replace(/\s+/g, ' ').trim();
  const right = incoming.replace(/\s+/g, ' ').trim();
  if (!left) return right;
  if (!right) return left;

  const leftLower = left.toLocaleLowerCase();
  const rightLower = right.toLocaleLowerCase();
  if (leftLower === rightLower) return left;
  if (rightLower.startsWith(`${leftLower} `)) return right;
  if (leftLower.startsWith(`${rightLower} `)) return left;

  const leftWords = left.split(' ');
  const rightWords = right.split(' ');
  const maxOverlap = Math.min(leftWords.length, rightWords.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    const suffix = leftWords.slice(-overlap).join(' ').toLocaleLowerCase();
    const prefix = rightWords.slice(0, overlap).join(' ').toLocaleLowerCase();
    if (suffix === prefix) return [...leftWords, ...rightWords.slice(overlap)].join(' ');
  }
  return `${left} ${right}`;
}

function collapseRecognitionSegments(parts: string[]): string {
  return parts.reduce((text, part) => mergeTranscript(text, part), '');
}

export class DictationController {
  private state: DictationState = 'idle';
  private finalText = '';
  private liveFinal = '';
  private interim = '';
  private error: string | null = null;

  private rec: RecognizerLike | null = null; // the CURRENT recognizer; events from any other are stale
  private hasHeardSpeech = false;
  private restarts = 0;
  private lastTransientError: string | null = null;
  private stopping = false;
  private restartTimer: unknown = null;
  private deadlineTimer: unknown = null;
  private startFailures = 0;
  // T-76: timestamp of the last recognizer start() — restarts are spaced at
  // least minRestartIntervalMs apart so pause/partial-driven restarts (each an
  // Android beep) cannot machine-gun.
  private lastStartAt = 0;

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
      minRestartIntervalMs: opts.minRestartIntervalMs ?? 1500,
      restartOnPause: opts.restartOnPause ?? true,
      maxConsecutiveStartFailures: opts.maxConsecutiveStartFailures ?? 3,
      now: opts.now ?? (() => Date.now()),
      setTimer: opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown),
      clearTimer: opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>)),
    };
  }

  snapshot(): DictationSnapshot {
    const committed = mergeTranscript(this.finalText, this.liveFinal);
    return {
      state: this.state,
      finalText: committed,
      interim: this.interim,
      elapsedMs: this.elapsed(),
      error: this.error,
      hasHeardSpeech: this.hasHeardSpeech,
      restarts: this.restarts,
      lastTransientError: this.lastTransientError,
      // The engine promotes recognized words to finals on a pause; an empty
      // interim buffer means nothing spoken is still in flight. (The UI holds
      // this briefly before showing it — finals clear interim mid-speech too.)
      caughtUp: this.state === 'recording' && this.hasHeardSpeech && !this.interim && committed.length > 0,
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
      this.hasHeardSpeech = true;
      const finalParts: string[] = [];
      const interimParts: string[] = [];
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        if (r.isFinal) finalParts.push(r[0].transcript);
        else interimParts.push(r[0].transcript);
      }
      this.liveFinal = collapseRecognitionSegments(finalParts);
      this.interim = collapseRecognitionSegments(interimParts);
      this.emit();
    };
    rec.onerror = (e) => {
      if (!isCurrent()) return;
      const err = e?.error ?? 'unknown';
      if (FATAL_ERRORS.has(err)) {
        this.error = err === 'audio-capture'
          ? 'No microphone is available.'
          : err === 'network'
          ? 'Speech recognition could not reach its service. Check your connection and try again.'
          : 'Microphone access was blocked. Enable mic permission to dictate.';
        this.clearRestart();
        this.clearDeadline();
        this.hardReset('idle');
        this.emit();
      }
      // transient (no-speech/aborted) → handled by onend; record the code so
      // the UI can explain a mute session instead of showing a silent timer
      else { this.lastTransientError = err; this.emit(); }
    };
    rec.onend = () => {
      if (!isCurrent()) return;
      this.commitLive();
      // T-107: on an AUTOMATIC restart, commit the interim tail too. Desktop
      // Chrome never replays it into the next generation, so leaving it live
      // let the fresh generation's first result erase everything spoken so
      // far (the host's disappearing-draft bug). Android's progressively
      // longer replays are safe to commit because mergeTranscript collapses
      // a cumulative or overlapping rehypothesis into the committed text
      // instead of appending it again.
      const premature = !this.stopping && this.state === 'recording';
      const autoRestart = premature && this.o.restartOnPause;
      if (autoRestart) { this.commitInterim(); this.restarts++; }
      this.emit();
      if (this.stopping) { this.finish(); return; }
      if (autoRestart) {
        // premature end (pause/silence/hiccup) — keep going, don't finalize
        this.rec = null; // ignore any further late events from this recognizer
        this.scheduleRestart();
      } else if (premature) {
        // T-130: no-restart mode (mobile). A premature end FINALIZES the draft
        // instead of beeping through a restart. finish() merges the interim
        // tail, so nothing spoken is lost — the mic session started exactly
        // once (one OS beep at start, none mid-recording).
        this.rec = null;
        this.finish();
      }
    };

    this.rec = rec;
    try {
      rec.start();
      this.lastStartAt = this.o.now(); // T-76: anchor for restart coalescing
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

  private commitLive() {
    if (this.liveFinal) { this.finalText = mergeTranscript(this.finalText, this.liveFinal); this.liveFinal = ''; }
  }
  private commitInterim() {
    if (this.interim) { this.finalText = mergeTranscript(this.finalText, this.interim); this.interim = ''; }
  }

  private scheduleRestart() {
    if (this.restartTimer != null) return;
    // T-76: never restart sooner than minRestartIntervalMs after the last
    // start. A flurry of pause/partial onends collapses into a single restart
    // (one beep) instead of one beep per pause, while a genuinely long gap
    // still revives recording. The floor is always at least restartBackoffMs.
    const sinceStart = this.o.now() - this.lastStartAt;
    const delay = Math.max(this.o.restartBackoffMs, this.o.minRestartIntervalMs - sinceStart);
    this.restartTimer = this.o.setTimer(() => {
      this.restartTimer = null;
      if (this.state === 'recording' && !this.stopping) this.spawn(false);
    }, delay);
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
    this.hasHeardSpeech = false; this.restarts = 0; this.lastTransientError = null;
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
    this.commitInterim();
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
    this.clearRestart();
    this.clearDeadline();
    const rec = this.rec;
    if (this.state === 'paused' || !rec) {
      this.commitLive();
      this.commitInterim();
      this.finish();
      return;
    }
    this.stopping = true;
    // SpeechRecognition may emit a last cumulative final result *after* stop().
    // Let onresult replace liveFinal and let onend commit it exactly once. The
    // old eager commit duplicated the pre-stop text when that final arrived.
    try { rec.stop(); } catch {
      this.commitLive();
      this.commitInterim();
      this.finish();
    }
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
    const text = mergeTranscript(this.finalText, this.interim);
    this.clearRestart();
    this.clearDeadline();
    this.hardReset('idle');
    this.emit();
    // Deliver even when empty: the one-tap Send intent (VoiceButton) must hear
    // back from every finish, or a Send tapped over a silent session strands
    // the composer's typed base draft unsent with no feedback. Insert-only
    // consumers already guard on text themselves.
    this.o.onFinalize(text);
  }

  private hardReset(state: DictationState) {
    this.state = state;
    this.finalText = ''; this.liveFinal = ''; this.interim = '';
    this.stopping = false; this.rec = null;
  }
}
