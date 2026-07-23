// T-131: silent, continuous dictation by capturing the mic ourselves instead
// of using the browser's built-in speech engine.
//
// The built-in engine on mobile fires the OS "listening" chime on every start
// and ends on every pause, so it can only ever be quiet-but-stops or
// continuous-but-beeps. Here we record raw audio with MediaRecorder in short
// COMPLETE segments, POST each to /api/transcribe, and stream the returned
// text into the composer. No built-in engine is touched, so there is no OS
// chime, and we cycle segments regardless of speech, so a pause never stops
// the session. Segments are transcribed in parallel but COMMITTED in order.
//
// The snapshot shape matches DictationController's so VoiceButton can swap
// controllers behind an engine-availability check with no UI changes.

import { mergeTranscript, type DictationSnapshot, type DictationState } from './dictation.js';

export interface RecorderLike {
  start(): void;
  stop(): void;
  ondata: ((blob: Blob) => void) | null;
  onstop: (() => void) | null;
  onerror: ((err: unknown) => void) | null;
}

export interface VoiceCaptureOptions {
  /** Acquire the mic stream (wraps getUserMedia). Rejects -> error state. */
  getStream: () => Promise<unknown>;
  /** Build a recorder for one segment; each stop() yields one complete blob. */
  createRecorder: (stream: unknown) => RecorderLike;
  /** Transcribe one complete audio segment on the server. */
  transcribe: (blob: Blob) => Promise<{ text: string; engine?: string }>;
  onChange: (s: DictationSnapshot) => void;
  onFinalize: (text: string) => void;
  /** Length of each recorded segment before it is cut and transcribed. */
  segmentMs?: number;
  /** Hard ceiling on total recording time. */
  maxMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

const IDLE_SNAPSHOT: DictationSnapshot = {
  state: 'idle', finalText: '', interim: '', elapsedMs: 0, error: null,
  hasHeardSpeech: false, restarts: 0, lastTransientError: null,
};

export class VoiceCaptureController {
  private o: Required<Omit<VoiceCaptureOptions, 'maxMs'>> & Pick<VoiceCaptureOptions, 'maxMs'>;
  private state: DictationState = 'idle';
  private stream: unknown = null;
  private rec: RecorderLike | null = null;
  private chunks: Blob[] = [];
  private finalText = '';
  private error: string | null = null;
  private startedAt = 0;
  private stopping = false;
  private segTimer: unknown = null;

  // Ordered-commit bookkeeping: segments are transcribed in parallel but the
  // recognized text must land in spoken order, so each segment gets a sequence
  // number and out-of-order results wait in `pending` until their turn.
  private seq = 0;             // next segment index to START
  private nextCommit = 0;      // next segment index to COMMIT
  private pending = new Map<number, string>();
  private inFlight = 0;        // transcriptions not yet resolved

  constructor(opts: VoiceCaptureOptions) {
    this.o = {
      getStream: opts.getStream,
      createRecorder: opts.createRecorder,
      transcribe: opts.transcribe,
      onChange: opts.onChange,
      onFinalize: opts.onFinalize,
      segmentMs: opts.segmentMs ?? 4000,
      maxMs: opts.maxMs,
      now: opts.now ?? (() => Date.now()),
      setTimer: opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown),
      clearTimer: opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
    };
  }

  snapshot(): DictationSnapshot {
    return {
      state: this.state,
      finalText: this.finalText,
      interim: '',
      elapsedMs: this.state === 'idle' ? 0 : Math.max(0, this.o.now() - this.startedAt),
      error: this.error,
      hasHeardSpeech: this.finalText.length > 0,
      restarts: 0,
      lastTransientError: null,
    };
  }

  private emit() { this.o.onChange(this.snapshot()); }

  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    this.error = null;
    this.finalText = '';
    this.seq = 0;
    this.nextCommit = 0;
    this.pending.clear();
    this.inFlight = 0;
    this.stopping = false;
    try {
      this.stream = await this.o.getStream();
    } catch (e) {
      this.state = 'idle';
      this.error = 'Microphone permission denied or unavailable.';
      this.emit();
      return;
    }
    this.state = 'recording';
    this.startedAt = this.o.now();
    this.emit();
    this.beginSegment();
  }

  private beginSegment(): void {
    if (this.state !== 'recording') return;
    if (this.o.maxMs && this.o.now() - this.startedAt >= this.o.maxMs) { this.stop(); return; }
    const mySeq = this.seq++;
    this.chunks = [];
    let rec: RecorderLike;
    try {
      rec = this.o.createRecorder(this.stream);
    } catch {
      this.error = 'Could not start the recorder.';
      this.emit();
      return;
    }
    this.rec = rec;
    rec.ondata = (blob: Blob) => { if (blob && (blob as { size?: number }).size !== 0) this.chunks.push(blob); };
    rec.onerror = () => { this.error = 'Recording error.'; this.emit(); };
    rec.onstop = () => {
      const parts = this.chunks;
      this.chunks = [];
      // Keep capturing immediately so a pause in speech never drops audio;
      // the just-finished segment transcribes in parallel.
      if (!this.stopping && this.state === 'recording') this.beginSegment();
      this.transcribeSegment(mySeq, parts);
    };
    rec.start();
    this.segTimer = this.o.setTimer(() => { this.cutSegment(); }, this.o.segmentMs);
  }

  private cutSegment(): void {
    if (this.segTimer) { this.o.clearTimer(this.segTimer); this.segTimer = null; }
    const rec = this.rec;
    this.rec = null;
    if (rec) { try { rec.stop(); } catch { /* already stopped */ } }
  }

  private transcribeSegment(mySeq: number, parts: Blob[]): void {
    this.inFlight++;
    const blob = parts.length ? new Blob(parts) : new Blob([]);
    this.o.transcribe(blob)
      .then((r) => this.commit(mySeq, r?.text || ''))
      .catch(() => this.commit(mySeq, '')) // a failed segment must not stall the queue
      .finally(() => {
        this.inFlight--;
        if (this.stopping && this.inFlight === 0) this.settle();
      });
  }

  // Commit recognized text in spoken order, buffering any that arrive early.
  private commit(seq: number, text: string): void {
    this.pending.set(seq, text);
    while (this.pending.has(this.nextCommit)) {
      const t = this.pending.get(this.nextCommit)!;
      this.pending.delete(this.nextCommit);
      this.nextCommit++;
      if (t) this.finalText = mergeTranscript(this.finalText, t);
    }
    this.emit();
  }

  stop(): void {
    if (this.state !== 'recording') return;
    this.stopping = true;
    if (this.segTimer) { this.o.clearTimer(this.segTimer); this.segTimer = null; }
    const rec = this.rec;
    this.rec = null;
    if (rec) { try { rec.stop(); } catch { /* noop */ } }
    // If nothing is left to transcribe, settle now; otherwise settle() runs
    // when the last in-flight segment resolves.
    if (this.inFlight === 0) this.settle();
  }

  private settle(): void {
    this.stopReleaseStream();
    this.state = 'idle';
    this.emit();
    this.o.onFinalize(this.finalText);
  }

  cancel(): void {
    this.stopping = true;
    if (this.segTimer) { this.o.clearTimer(this.segTimer); this.segTimer = null; }
    const rec = this.rec;
    this.rec = null;
    if (rec) { try { rec.stop(); } catch { /* noop */ } }
    this.pending.clear();
    this.finalText = '';
    this.inFlight = 0;
    this.stopReleaseStream();
    this.state = 'idle';
    this.emit();
  }

  private stopReleaseStream(): void {
    const s = this.stream as { getTracks?: () => Array<{ stop: () => void }> } | null;
    if (s && typeof s.getTracks === 'function') { for (const t of s.getTracks()) { try { t.stop(); } catch { /* noop */ } } }
    this.stream = null;
  }
}

export { IDLE_SNAPSHOT };
