import { describe, it, expect, beforeEach } from 'vitest';
import { VoiceCaptureController, type RecorderLike } from './voiceCapture.js';
import type { DictationSnapshot } from './dictation.js';

// Deferred so a test can resolve segment transcriptions in any order.
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

interface Harness {
  ctrl: VoiceCaptureController;
  tick: () => void;              // fire the pending segment timer (cut segment)
  recorders: FakeRecorder[];
  transcripts: Array<ReturnType<typeof deferred<{ text: string }>>>;
  snaps: DictationSnapshot[];
  finals: string[];
  streamStopped: () => boolean;
}

class FakeRecorder implements RecorderLike {
  ondata: ((b: Blob) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  started = false;
  stopped = false;
  start() { this.started = true; }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.ondata?.(new Blob([new Uint8Array([1, 2, 3])]));
    this.onstop?.();
  }
}

function makeHarness(opts: { getStreamRejects?: boolean } = {}): Harness {
  const recorders: FakeRecorder[] = [];
  const transcripts: Array<ReturnType<typeof deferred<{ text: string }>>> = [];
  const snaps: DictationSnapshot[] = [];
  const finals: string[] = [];
  let currentTimer: (() => void) | null = null;
  let clock = 1000;
  let stopped = false;
  const tracks = [{ stop: () => { stopped = true; } }];

  const ctrl = new VoiceCaptureController({
    getStream: async () => {
      if (opts.getStreamRejects) throw new Error('denied');
      return { getTracks: () => tracks };
    },
    createRecorder: () => { const r = new FakeRecorder(); recorders.push(r); return r; },
    transcribe: () => { const d = deferred<{ text: string }>(); transcripts.push(d); return d.promise; },
    onChange: (s) => snaps.push(s),
    onFinalize: (t) => finals.push(t),
    segmentMs: 4000,
    now: () => clock,
    setTimer: (fn) => { currentTimer = fn; return 1; },
    clearTimer: () => { currentTimer = null; },
  });

  return {
    ctrl,
    tick: () => { const fn = currentTimer; currentTimer = null; clock += 4000; fn?.(); },
    recorders, transcripts, snaps, finals,
    streamStopped: () => stopped,
  };
}

describe('VoiceCaptureController', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });

  it('commits segment text in spoken order even when transcriptions resolve out of order', async () => {
    await h.ctrl.start();
    h.tick(); // cut segment 0 -> starts segment 1, transcribe(0) in flight
    h.tick(); // cut segment 1 -> starts segment 2, transcribe(1) in flight
    expect(h.transcripts.length).toBe(2);
    // Resolve segment 1 FIRST; it must NOT appear until segment 0 commits.
    h.transcripts[1]!.resolve({ text: 'world' });
    await flush();
    expect(h.ctrl.snapshot().finalText).toBe('');
    h.transcripts[0]!.resolve({ text: 'hello' });
    await flush();
    expect(h.ctrl.snapshot().finalText).toBe('hello world');
  });

  it('a silent pause (empty transcript) adds nothing but keeps recording', async () => {
    await h.ctrl.start();
    const recordersAfterStart = h.recorders.length; // 1
    h.tick(); // cut seg 0 -> begins seg 1
    h.transcripts[0]!.resolve({ text: '' }); // silence
    await flush();
    expect(h.ctrl.snapshot().finalText).toBe('');
    expect(h.ctrl.snapshot().state).toBe('recording'); // did NOT stop on the pause
    expect(h.recorders.length).toBeGreaterThan(recordersAfterStart); // cycled to a new segment
  });

  it('finalizes with the full transcript only after in-flight segments settle', async () => {
    await h.ctrl.start();
    h.tick(); // cut seg 0 (in flight) -> seg 1 recording
    h.ctrl.stop(); // cuts seg 1 as the final partial segment -> also in flight
    expect(h.finals.length).toBe(0); // not finalized while segments are transcribing
    h.transcripts[0]!.resolve({ text: 'done' });
    await flush();
    expect(h.finals.length).toBe(0); // final partial segment still transcribing
    h.transcripts[1]!.resolve({ text: '' });
    await flush();
    expect(h.finals).toEqual(['done']);
    expect(h.ctrl.snapshot().state).toBe('idle');
    expect(h.streamStopped()).toBe(true); // mic track released
  });

  it('a failed segment transcription does not stall the commit queue', async () => {
    await h.ctrl.start();
    h.tick();
    h.tick();
    h.transcripts[0]!.reject(new Error('network'));
    h.transcripts[1]!.resolve({ text: 'after' });
    await flush();
    expect(h.ctrl.snapshot().finalText).toBe('after');
  });

  it('surfaces an error and stays idle when the mic is denied', async () => {
    const denied = makeHarness({ getStreamRejects: true });
    await denied.ctrl.start();
    expect(denied.ctrl.snapshot().state).toBe('idle');
    expect(denied.ctrl.snapshot().error).toMatch(/permission|denied|unavailable/i);
    expect(denied.recorders.length).toBe(0);
  });

  it('cancel discards the draft and never finalizes', async () => {
    await h.ctrl.start();
    h.tick();
    h.transcripts[0]!.resolve({ text: 'throwaway' });
    await flush();
    h.ctrl.cancel();
    expect(h.ctrl.snapshot().finalText).toBe('');
    expect(h.ctrl.snapshot().state).toBe('idle');
    expect(h.finals.length).toBe(0);
    expect(h.streamStopped()).toBe(true);
  });
});
