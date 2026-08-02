import { describe, it, expect, beforeEach } from 'vitest';
import { VoiceCaptureController, createMemoryStore, type RecorderLike, type SegmentStoreLike } from './voiceCapture.js';
import type { DictationSnapshot } from './dictation.js';

// Drain enough microtask turns to let the async pump process a full buffer
// (each segment does several awaits: pending -> transcribe -> delete).
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };

class FakeRecorder implements RecorderLike {
  ondata: ((b: Blob) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  stopped = false;
  constructor(private label: string) {}
  start() {}
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    // Non-empty blob tagged by segment so assertions can read spoken order.
    this.ondata?.(new Blob([this.label]));
    this.onstop?.();
  }
}

interface Harness {
  ctrl: VoiceCaptureController;
  tick: () => void;                  // fire the current segment timer (cut it)
  fireRetry: () => void;             // fire a pending retry timer
  setServerUp: (up: boolean) => void;
  snaps: DictationSnapshot[];
  finals: string[];
  store: SegmentStoreLike;
  storeCount: () => Promise<number>;
  streamStopped: () => boolean;
  transcribeCalls: () => number;
}

function makeHarness(opts: { getStreamRejects?: boolean; transcribeAs?: (label: string) => string } = {}): Harness {
  const snaps: DictationSnapshot[] = [];
  const finals: string[] = [];
  const store = createMemoryStore();
  let segTimer: (() => void) | null = null;
  let retryTimer: (() => void) | null = null;
  let clock = 1000;
  let streamStopped = false;
  let serverUp = true;
  let calls = 0;
  const tracks = [{ stop: () => { streamStopped = true; } }];
  let recCount = 0;

  const ctrl = new VoiceCaptureController({
    getStream: async () => { if (opts.getStreamRejects) throw new Error('denied'); return { getTracks: () => tracks }; },
    createRecorder: () => new FakeRecorder(`seg${recCount++}`),
    // The blob text is the segment label; the "transcript" is that label so
    // ordering is checkable. Throws while the server is down (never drops audio).
    transcribe: async (blob: Blob) => {
      calls++;
      if (!serverUp) throw new Error('server down');
      const label = await blob.text();
      return { text: opts.transcribeAs ? opts.transcribeAs(label) : label };
    },
    store,
    onChange: (s) => snaps.push(s),
    onFinalize: (t) => finals.push(t),
    segmentMs: 4000,
    retryMs: 2000,
    now: () => clock,
    setTimer: (fn, ms) => { if (ms === 2000) retryTimer = fn; else segTimer = fn; return 1; },
    clearTimer: () => {},
  });

  return {
    ctrl,
    tick: () => { const fn = segTimer; segTimer = null; clock += 4000; fn?.(); },
    fireRetry: () => { const fn = retryTimer; retryTimer = null; fn?.(); },
    setServerUp: (up) => { serverUp = up; },
    snaps, finals, store,
    storeCount: async () => (await store.pending()).length,
    streamStopped: () => streamStopped,
    transcribeCalls: () => calls,
  };
}

describe('VoiceCaptureController (durable)', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });

  it('transcribes segments in spoken order and grows the transcript', async () => {
    await h.ctrl.start();
    h.tick(); await flush(); // cut seg0 -> stored -> pumped
    h.tick(); await flush(); // cut seg1 -> stored -> pumped
    expect(h.ctrl.snapshot().finalText).toBe('seg0 seg1');
    expect(await h.storeCount()).toBe(0); // committed segments deleted locally
  });

  it('keeps recording across a pause (never stops on its own)', async () => {
    await h.ctrl.start();
    h.tick(); await flush();
    h.tick(); await flush();
    expect(h.ctrl.snapshot().state).toBe('recording');
  });

  it('DURABILITY: audio survives a server outage and reconstructs on reconnect', async () => {
    await h.ctrl.start();
    // Server goes down; keep speaking. Segments must buffer locally, not drop.
    h.setServerUp(false);
    h.tick(); await flush(); // seg0 -> stored, upload fails -> offline
    h.tick(); await flush(); // seg1 -> stored
    h.tick(); await flush(); // seg2 -> stored
    expect(h.ctrl.snapshot().offline).toBe(true);
    expect(h.ctrl.snapshot().pendingUploads).toBe(3);
    expect(await h.storeCount()).toBe(3);         // three segments safe on disk
    expect(h.ctrl.snapshot().finalText).toBe(''); // nothing transcribed yet

    // Server restored; the retry drains the whole buffer in spoken order.
    h.setServerUp(true);
    h.fireRetry(); await flush();
    expect(h.ctrl.snapshot().finalText).toBe('seg0 seg1 seg2'); // nothing lost, in order
    expect(h.ctrl.snapshot().offline).toBe(false);
    expect(h.ctrl.snapshot().pendingUploads).toBe(0);
    expect(await h.storeCount()).toBe(0);
  });

  it('stop finalizes only after the local buffer fully drains', async () => {
    await h.ctrl.start();
    h.setServerUp(false);
    h.tick(); await flush();     // seg0 buffered, server down
    h.ctrl.stop();               // cuts final segment; both are buffered
    await flush();
    expect(h.ctrl.snapshot().state).toBe('processing');
    expect(h.streamStopped()).toBe(true); // mic is off; only transcription remains
    expect(h.finals.length).toBe(0); // cannot finalize while segments are buffered
    h.setServerUp(true);
    h.fireRetry(); await flush();
    expect(h.finals.length).toBe(1);
    expect(h.finals[0]).toContain('seg0');
    expect(h.ctrl.snapshot().state).toBe('idle');
    expect(h.streamStopped()).toBe(true);
  });

  it('POISON: a permanently-rejected segment is dropped so the good ones behind it drain', async () => {
    // Second segment throws a permanent error; first and third must still land.
    let recN = 0;
    const store = createMemoryStore();
    const snaps: DictationSnapshot[] = [];
    const finals: string[] = [];
    let seg: (() => void) | null = null;
    let clock = 2000;
    const ctrl = new VoiceCaptureController({
      getStream: async () => ({ getTracks: () => [{ stop() {} }] }),
      createRecorder: () => new FakeRecorder(`seg${recN++}`),
      transcribe: async (blob) => {
        const label = await blob.text();
        if (label === 'seg1') throw Object.assign(new Error('bad'), { permanent: true });
        return { text: label };
      },
      store,
      onChange: (s) => snaps.push(s),
      onFinalize: (t) => finals.push(t),
      segmentMs: 4000, retryMs: 2000,
      now: () => clock,
      setTimer: (fn, ms) => { if (ms !== 2000) seg = fn; return 1; },
      clearTimer: () => {},
    });
    await ctrl.start();
    // n increments per createRecorder; label = seg(n-at-create). Drive 3 segments.
    const tick = () => { const fn = seg; seg = null; clock += 4000; fn?.(); };
    tick(); await flush(); // seg0 -> ok
    tick(); await flush(); // seg1 -> permanent drop
    tick(); await flush(); // seg2 -> ok
    const snap = ctrl.snapshot();
    expect(snap.droppedSegments).toBe(1);          // the poison clip was abandoned
    expect(snap.finalText).toContain('seg0');
    expect(snap.finalText).toContain('seg2');       // the good clip BEHIND it still drained
    expect(snap.offline).toBe(false);               // a poison clip is not an outage
    expect((await store.pending()).length).toBe(0); // queue fully drained past it
  });

  it('RATE-LIMIT: a 429-style transient failure retries and lands, never dropped as poison', async () => {
    // A 429 is a 4xx but is signalled transient (no `permanent` flag), so it
    // must take the retry path, not the poison-drop path. First attempt on the
    // segment throws transient; the retry succeeds and the text lands.
    let recN = 0;
    const attempts = new Map<string, number>();
    const store = createMemoryStore();
    const snaps: DictationSnapshot[] = [];
    const timers: { seg: (() => void) | null; ret: (() => void) | null } = { seg: null, ret: null };
    let clock = 3000;
    const ctrl = new VoiceCaptureController({
      getStream: async () => ({ getTracks: () => [{ stop() {} }] }),
      createRecorder: () => new FakeRecorder(`seg${recN++}`),
      transcribe: async (blob) => {
        const label = await blob.text();
        const n = (attempts.get(label) ?? 0) + 1;
        attempts.set(label, n);
        if (n === 1) throw new Error('429 rate limited'); // transient: NO permanent flag
        return { text: label };
      },
      store,
      onChange: (s) => snaps.push(s),
      onFinalize: () => {},
      segmentMs: 4000, retryMs: 2000,
      now: () => clock,
      setTimer: (fn, ms) => { if (ms === 2000) timers.ret = fn; else timers.seg = fn; return 1; },
      clearTimer: () => {},
    });
    await ctrl.start();
    const tick = () => { const fn = timers.seg; timers.seg = null; clock += 4000; fn?.(); };
    tick(); await flush(); // seg0 -> first attempt 429 -> offline, buffered, retry scheduled
    expect(ctrl.snapshot().offline).toBe(true);
    expect(ctrl.snapshot().droppedSegments).toBe(0); // NOT dropped
    const fire = timers.ret; timers.ret = null; fire?.(); await flush(); // retry -> succeeds
    expect(ctrl.snapshot().finalText).toContain('seg0'); // it landed
    expect(ctrl.snapshot().droppedSegments).toBe(0);     // never counted as poison
    expect((await store.pending()).length).toBe(0);      // drained
  });

  it('surfaces an error and stays idle when the mic is denied', async () => {
    const denied = makeHarness({ getStreamRejects: true });
    await denied.ctrl.start();
    expect(denied.ctrl.snapshot().state).toBe('idle');
    expect(denied.ctrl.snapshot().error).toMatch(/permission|denied|unavailable/i);
  });

  it('cancel discards the buffer and never finalizes', async () => {
    await h.ctrl.start();
    h.tick(); await flush();
    h.ctrl.cancel();
    await flush();
    expect(h.ctrl.snapshot().finalText).toBe('');
    expect(h.ctrl.snapshot().state).toBe('idle');
    expect(h.finals.length).toBe(0);
    expect(await h.storeCount()).toBe(0);
    expect(h.streamStopped()).toBe(true);
  });
});

// Caught-up: the transcript has caught up with SPEECH, not just with uploads.
// pending===0 is true most of the time even mid-sentence (segments cut every
// segmentMs and only pulse pending during the round-trip), so the detector
// keys on the last resolved segment containing no recognized speech.
describe('caughtUp — transcription caught up with speech', () => {
  it('mid-speech segments keep it false; a silent segment resolving flips it true', async () => {
    const h = makeHarness({ transcribeAs: (l) => (l === 'seg2' ? '' : l) });
    await h.ctrl.start();
    expect(h.ctrl.snapshot().caughtUp).toBe(false); // nothing heard yet
    h.tick(); await flush(); // seg0: speech
    expect(h.ctrl.snapshot().caughtUp).toBe(false); // last resolve had text — speaker may still be going
    h.tick(); await flush(); // seg1: speech
    expect(h.ctrl.snapshot().caughtUp).toBe(false);
    h.tick(); await flush(); // seg2: silence → everything said is in the transcript
    expect(h.ctrl.snapshot().caughtUp).toBe(true);
  });

  it('silence before any speech is NOT caught up (nothing to send)', async () => {
    const h = makeHarness({ transcribeAs: () => '' });
    await h.ctrl.start();
    h.tick(); await flush();
    expect(h.ctrl.snapshot().caughtUp).toBe(false);
  });

  it('re-arms on new speech and never claims caught-up while buffering offline', async () => {
    const h = makeHarness({ transcribeAs: (l) => (l === 'seg0' || l === 'seg2' ? 'words' : '') });
    await h.ctrl.start();
    h.tick(); await flush(); // seg0: speech
    h.tick(); await flush(); // seg1: silence → caught up
    expect(h.ctrl.snapshot().caughtUp).toBe(true);
    h.setServerUp(false);
    h.tick(); await flush(); // seg2: speech, buffered locally (offline)
    expect(h.ctrl.snapshot().caughtUp).toBe(false); // pending + offline both veto
    expect(h.ctrl.snapshot().offline).toBe(true);
    h.setServerUp(true);
    h.fireRetry(); await flush(); // seg2 resolves WITH text → still in-flight speech-wise
    expect(h.ctrl.snapshot().caughtUp).toBe(false);
  });
});
