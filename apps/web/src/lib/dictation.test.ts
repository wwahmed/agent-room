import { describe, expect, it } from 'vitest';
import { DictationController, type RecognizerLike, type DictationSnapshot } from './dictation.js';

// Fake SpeechRecognition: the test drives onresult/onend/onerror. stop()/abort()
// fire onend synchronously, mirroring how the browser ends a session. An
// optional `failStart` makes start() throw synchronously.
class FakeRec implements RecognizerLike {
  lang = ''; continuous = false; interimResults = false;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  started = false; stopped = false; aborted = false;
  constructor(private failStart = false) {}
  start() { if (this.failStart) throw new Error('start failed'); this.started = true; }
  stop() { this.stopped = true; this.onend?.(); }
  abort() { this.aborted = true; this.onend?.(); }
  emit(items: Array<{ final: boolean; text: string }>) {
    const results: any = items.map(it => ({ isFinal: it.final, 0: { transcript: it.text } }));
    results.length = items.length;
    this.onresult?.({ resultIndex: 0, results });
  }
}

function harness(opts: { maxMs?: number; failStartAll?: boolean } = {}) {
  const recs: FakeRec[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  let clock = 0;
  const finals: string[] = [];
  let snap: DictationSnapshot | null = null;
  const c = new DictationController({
    createRecognizer: () => { const r = new FakeRec(opts.failStartAll); recs.push(r); return r; },
    onChange: (s) => { snap = s; },
    onFinalize: (t) => finals.push(t),
    now: () => clock,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; },
    clearTimer: (id) => { const i = id as number; if (timers[i]) timers[i] = { fn: () => {}, ms: -1 }; },
    restartBackoffMs: 10,
    maxMs: opts.maxMs,
  });
  return {
    c, finals, recs,
    cur: () => recs[recs.length - 1]!,
    recCount: () => recs.length,
    // restart timers are short (<=100ms); the deadline is long (maxMs)
    flushRestarts: () => { timers.filter(t => t.ms >= 0 && t.ms <= 100).forEach(t => { const f = t.fn; t.ms = -1; f(); }); },
    flushDeadline: () => { timers.filter(t => t.ms > 100).forEach(t => { const f = t.fn; t.ms = -1; f(); }); },
    // ms of the last still-live deadline timer (for remaining-time assertions)
    liveDeadlineMs: () => { const d = timers.filter(t => t.ms > 100); return d.length ? d[d.length - 1]!.ms : null; },
    tick: (ms: number) => { clock += ms; },
    snap: () => snap!,
  };
}

describe('DictationController', () => {
  it('accumulates final text and shows interim while recording', () => {
    const h = harness();
    h.c.start();
    h.cur().emit([{ final: true, text: 'hello ' }, { final: false, text: 'wor' }]);
    expect(h.snap().finalText).toBe('hello');
    expect(h.snap().interim).toBe('wor');
  });

  it('a short pause (onend while recording) auto-restarts and preserves text — no finalize', () => {
    const h = harness();
    h.c.start();
    h.cur().emit([{ final: true, text: 'first part ' }]);
    h.cur().onend?.();
    expect(h.finals).toHaveLength(0);
    expect(h.snap().state).toBe('recording');
    h.flushRestarts();
    expect(h.recCount()).toBe(2);
    h.cur().emit([{ final: true, text: 'second part' }]);
    expect(h.snap().finalText).toBe('first part second part');
    expect(h.finals).toHaveLength(0);
  });

  it('explicit pause PRESERVES interim (not just final) and does not finalize; resume continues', () => {
    const h = harness();
    h.c.start();
    h.cur().emit([{ final: true, text: 'before ' }, { final: false, text: 'interim words' }]);
    h.c.pause();
    expect(h.snap().state).toBe('paused');
    expect(h.snap().finalText).toBe('before interim words'); // interim promoted, not lost
    expect(h.finals).toHaveLength(0);
    h.c.resume();
    h.cur().emit([{ final: true, text: 'after resume' }]);
    expect(h.snap().finalText).toBe('before interim words after resume');
  });

  it('finalizes and delivers only on explicit Stop (including trailing interim)', () => {
    const h = harness();
    h.c.start();
    h.cur().emit([{ final: true, text: 'committed ' }, { final: false, text: 'trailing' }]);
    h.c.stop();
    expect(h.snap().state).toBe('idle');
    expect(h.finals).toEqual(['committed trailing']);
  });

  it('cancel discards everything — no delivery', () => {
    const h = harness();
    h.c.start();
    h.cur().emit([{ final: true, text: 'throwaway' }]);
    h.c.cancel();
    expect(h.snap().state).toBe('idle');
    expect(h.snap().finalText).toBe('');
    expect(h.finals).toHaveLength(0);
  });

  it('mic-denied is fatal: idle + error, no auto-restart, no delivery', () => {
    const h = harness();
    h.c.start();
    h.cur().onerror?.({ error: 'not-allowed' });
    expect(h.snap().state).toBe('idle');
    expect(h.snap().error).toMatch(/mic|blocked/i);
    h.flushRestarts();
    expect(h.recCount()).toBe(1);
    expect(h.finals).toHaveLength(0);
  });

  it('pause-aware hard deadline auto-finalizes even during silence', () => {
    const h = harness({ maxMs: 1000 });
    h.c.start();
    h.cur().emit([{ final: true, text: 'long dictation' }]);
    h.tick(1000);
    h.flushDeadline(); // the real deadline timer fires with no further speech events
    expect(h.snap().state).toBe('idle');
    expect(h.finals).toEqual(['long dictation']);
  });

  it('IGNORES delayed events from a replaced recognizer (generation guard)', () => {
    const h = harness();
    h.c.start();
    const rec1 = h.cur();
    rec1.emit([{ final: true, text: 'good ' }]);
    rec1.onend?.();          // rec1 ends → schedules restart, rec1 no longer current
    h.flushRestarts();       // spawn rec2
    expect(h.recCount()).toBe(2);
    rec1.emit([{ final: true, text: 'STALE GARBAGE' }]); // delayed rec1 event
    h.cur().emit([{ final: true, text: 'more' }]);
    expect(h.snap().finalText).toBe('good more'); // stale text never entered
  });

  it('synchronous start() failure does NOT leave a false Recording state', () => {
    const h = harness({ failStartAll: true });
    h.c.start();
    expect(h.snap().state).toBe('idle');   // not 'recording'
    expect(h.snap().error).toMatch(/microphone|start/i);
    expect(h.finals).toHaveLength(0);
  });

  it('Pause clears the deadline even when its timer handle is 0, and Resume reschedules for the REMAINING active time', () => {
    const h = harness({ maxMs: 10000 });
    h.c.start();                    // deadline scheduled — its handle is 0 in this harness
    expect(h.liveDeadlineMs()).toBe(10000);
    h.tick(3000);                   // 3s of active recording
    h.cur().emit([{ final: true, text: 'kept' }]);
    h.c.pause();                    // must clear the handle-0 deadline (truthiness would miss it)
    h.flushDeadline();              // if the stale deadline survived, this would fire Stop
    expect(h.snap().state).toBe('paused'); // still paused — not prematurely finalized
    expect(h.finals).toHaveLength(0);
    h.c.resume();
    expect(h.liveDeadlineMs()).toBe(7000);  // pause-aware: 10000 - 3000 active
    h.cur().emit([{ final: true, text: 'more' }]);
    h.c.stop();
    expect(h.finals).toEqual(['kept more']);
  });

  it('tracks active elapsed time, excluding paused time', () => {
    const h = harness();
    h.c.start();
    h.tick(3000);
    h.c.pause();
    h.tick(5000);
    h.c.resume();
    h.tick(2000);
    expect(h.c.snapshot().elapsedMs).toBe(5000);
  });
});
