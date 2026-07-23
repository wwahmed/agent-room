// T-131: silent, continuous, DURABLE dictation. We capture the mic ourselves
// (MediaRecorder) instead of using the browser's built-in speech engine, so
// there is no OS "listening" chime and a pause never ends the session.
//
// Durability (host requirement): audio must never be lost to a network/server
// blip. So capture and upload are DECOUPLED:
//   capture  -> every recorded segment is written to a local store
//               (IndexedDB) FIRST. The local copy is the source of truth.
//   pump     -> a separate loop drains the store in order: transcribe a
//               segment, append its text, and only THEN delete it locally.
// If the server drops mid-recording, capture keeps filling the store and the
// pump retries with backoff; when the server returns, the pump drains
// everything in spoken order and the transcript reconstructs with nothing lost.
// Because the pump is strictly sequential, transcript order is guaranteed.

import { mergeTranscript, type DictationSnapshot, type DictationState } from './dictation.js';

export interface RecorderLike {
  start(): void;
  stop(): void;
  ondata: ((blob: Blob) => void) | null;
  onstop: (() => void) | null;
  onerror: ((err: unknown) => void) | null;
}

export interface StoredSegment { seq: number; blob: Blob }

// A durable, ordered segment queue. IndexedDB in the browser; an in-memory fake
// in tests. pending() returns segments sorted ascending by seq.
export interface SegmentStoreLike {
  put(seg: StoredSegment): Promise<void>;
  pending(): Promise<StoredSegment[]>;
  delete(seq: number): Promise<void>;
  clear(): Promise<void>;
}

export interface VoiceCaptureOptions {
  getStream: () => Promise<unknown>;
  createRecorder: (stream: unknown) => RecorderLike;
  /** Transcribe one segment. MUST reject/throw on any failure so the pump keeps
   *  the segment buffered locally and retries, rather than dropping audio. */
  transcribe: (blob: Blob) => Promise<{ text: string }>;
  store: SegmentStoreLike;
  onChange: (s: DictationSnapshot) => void;
  onFinalize: (text: string) => void;
  segmentMs?: number;
  maxMs?: number;
  retryMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

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
  private settled = false;
  private segTimer: unknown = null;
  private retryTimer: unknown = null;

  private enqueueSeq = 0;      // next segment index to assign
  private pendingCount = 0;    // segments buffered locally, not yet transcribed
  private droppedCount = 0;    // segments the server permanently rejected (poison)
  private pumpRunning = false;
  private offline = false;     // last upload attempt failed -> buffering locally

  constructor(opts: VoiceCaptureOptions) {
    this.o = {
      getStream: opts.getStream,
      createRecorder: opts.createRecorder,
      transcribe: opts.transcribe,
      store: opts.store,
      onChange: opts.onChange,
      onFinalize: opts.onFinalize,
      // 2.5s balances felt latency against per-segment recognition context: a
      // word spoken right after a cut appears in ~segmentMs, so shorter feels
      // more live. whisper base at ~0.1s/clip has ample headroom for the extra
      // requests. (UX-Adversary: report end-to-end, not whisper-only, latency.)
      segmentMs: opts.segmentMs ?? 2500,
      maxMs: opts.maxMs,
      retryMs: opts.retryMs ?? 2000,
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
      // Surfaced so the composer can show "saved locally, will transcribe when
      // reconnected" without a separate channel.
      pendingUploads: this.pendingCount,
      offline: this.offline,
      droppedSegments: this.droppedCount,
      lastTransientError: null,
    };
  }

  private emit() { this.o.onChange(this.snapshot()); }

  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    this.error = null;
    this.finalText = '';
    this.enqueueSeq = 0;
    this.pendingCount = 0;
    this.droppedCount = 0;
    this.stopping = false;
    this.settled = false;
    this.offline = false;
    await this.o.store.clear().catch(() => {});
    try {
      this.stream = await this.o.getStream();
    } catch {
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
    rec.onstop = () => { void this.onSegmentStopped(); };
    rec.start();
    this.segTimer = this.o.setTimer(() => { this.cutSegment(); }, this.o.segmentMs);
  }

  private async onSegmentStopped(): Promise<void> {
    const parts = this.chunks;
    this.chunks = [];
    // T-138: a pause/cancel (settled) drops this tail segment — the user took
    // over with the keyboard and everything already streamed is in the draft.
    if (this.settled) return;
    // Keep capturing immediately so a pause in speech never drops audio.
    if (!this.stopping && this.state === 'recording') this.beginSegment();
    const blob = parts.length ? new Blob(parts) : null;
    if (blob && blob.size > 0) {
      const seq = this.enqueueSeq++;
      await this.o.store.put({ seq, blob }); // DURABLE: land locally before any upload
      this.pendingCount++;
      this.emit();
      void this.pump();
    }
    if (this.stopping) this.maybeSettle();
  }

  private cutSegment(): void {
    if (this.segTimer) { this.o.clearTimer(this.segTimer); this.segTimer = null; }
    const rec = this.rec;
    this.rec = null;
    if (rec) { try { rec.stop(); } catch { /* already stopped */ } }
  }

  // Drain the local store in order. On any transcribe failure, mark offline and
  // retry later — the segment stays buffered, never dropped.
  private async pump(): Promise<void> {
    if (this.pumpRunning) return;
    this.pumpRunning = true;
    try {
      for (;;) {
        const items = await this.o.store.pending();
        if (items.length === 0) break;
        const item = items[0]!;
        try {
          const res = await this.o.transcribe(item.blob);
          // T-138: a pause/cancel while this segment was in flight — do not
          // commit or emit late text over the draft the user is now editing.
          if (this.settled) return;
          this.offline = false;
          if (res && res.text) this.finalText = mergeTranscript(this.finalText, res.text);
          await this.o.store.delete(item.seq);
          this.pendingCount = Math.max(0, this.pendingCount - 1);
          this.emit();
        } catch (err) {
          if ((err as { permanent?: boolean } | null)?.permanent) {
            // Poison segment: the server can never transcribe THIS clip. Give up
            // on it alone, drain past it, and surface it honestly — one bad
            // 2.5s piece must never block or silently drop the whole session.
            await this.o.store.delete(item.seq).catch(() => {});
            this.pendingCount = Math.max(0, this.pendingCount - 1);
            this.droppedCount++;
            this.emit();
            continue; // keep draining the good segments behind it
          }
          // Transient (engine down / network): keep this and later segments
          // buffered and retry — the outage-recovery contract.
          this.offline = true;
          this.emit();
          this.scheduleRetry();
          return;
        }
      }
    } finally {
      this.pumpRunning = false;
    }
    // Store fully drained.
    this.offline = false;
    this.emit();
    if (this.stopping) this.maybeSettle();
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = this.o.setTimer(() => { this.retryTimer = null; void this.pump(); }, this.o.retryMs);
  }

  stop(): void {
    if (this.state !== 'recording') return;
    this.stopping = true;
    if (this.segTimer) { this.o.clearTimer(this.segTimer); this.segTimer = null; }
    const rec = this.rec;
    this.rec = null;
    if (rec) { try { rec.stop(); } catch { /* noop */ } }
    else this.maybeSettle();
  }

  // Finalize only once every segment has been transcribed AND removed from the
  // local store. If the server is down at stop time, the draft stays buffered
  // and finalizes when the pump drains it after reconnection (nothing lost).
  private maybeSettle(): void {
    if (!this.stopping || this.settled) return;
    if (this.pendingCount > 0 || this.pumpRunning) return;
    this.settled = true;
    this.stopReleaseStream();
    this.state = 'idle';
    this.emit();
    this.o.onFinalize(this.finalText);
  }

  cancel(): void {
    this.stopping = true;
    this.settled = true;
    if (this.segTimer) { this.o.clearTimer(this.segTimer); this.segTimer = null; }
    if (this.retryTimer) { this.o.clearTimer(this.retryTimer); this.retryTimer = null; }
    const rec = this.rec;
    this.rec = null;
    if (rec) { try { rec.stop(); } catch { /* noop */ } }
    this.finalText = '';
    this.pendingCount = 0;
    void this.o.store.clear().catch(() => {});
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

// ---- IndexedDB-backed segment store (production) --------------------------
// One object store keyed by seq. Survives reloads, so audio persists even if
// the tab is refreshed mid-outage, not just across a server blip.
export function createIndexedDbStore(dbName = 'ar-dictation'): SegmentStoreLike {
  const STORE = 'segments';
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'seq' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      t.oncomplete = () => db.close();
    });
  }
  return {
    put: (seg) => tx('readwrite', (s) => s.put(seg)).then(() => {}),
    delete: (seq) => tx('readwrite', (s) => s.delete(seq)).then(() => {}),
    clear: () => tx('readwrite', (s) => s.clear()).then(() => {}),
    pending: () =>
      tx<StoredSegment[]>('readonly', (s) => s.getAll() as IDBRequest<StoredSegment[]>).then((all) =>
        (all || []).sort((a, b) => a.seq - b.seq),
      ),
  };
}

// In-memory store — a safe fallback where IndexedDB is unavailable (still gives
// server-outage durability within the session, just not across a reload).
export function createMemoryStore(): SegmentStoreLike {
  let segs: StoredSegment[] = [];
  return {
    put: async (seg) => { segs = segs.filter((s) => s.seq !== seg.seq).concat(seg); },
    delete: async (seq) => { segs = segs.filter((s) => s.seq !== seq); },
    clear: async () => { segs = []; },
    pending: async () => [...segs].sort((a, b) => a.seq - b.seq),
  };
}
