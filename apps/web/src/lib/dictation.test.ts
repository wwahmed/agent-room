import { describe, expect, it } from 'vitest';
import { DictationController, type RecognizerLike, type DictationSnapshot } from './dictation.js';

// Fake SpeechRecognition: the test drives onresult/onend/onerror. stop()/abort()
// fire onend synchronously, mirroring how the browser ends a session.
class FakeRec implements RecognizerLike {
  lang = ''; continuous = false; interimResults = false;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  started = false; stopped = false; aborted = false;
  start() { this.started = true; }
  stop() { this.stopped = true; this.onend?.(); }
  abort() { this.aborted = true; this.onend?.(); }
  // emit the FULL cumulative result list (as the browser does)
  emit(items: Array<{ final: boolean; text: string }>) {
    const results: any = items.map(it => ({ isFinal: it.final, 0: { transcript: it.text } }));
    results.length = items.length;
    this.onresult?.({ resultIndex: 0, results });
  }
}

function harness(opts: { maxMs?: number } = {}) {
  const recs: FakeRec[] = [];
  const timers: Array<() => void> = [];
  let clock = 0;
  const finals: string[] = [];
  let snap: DictationSnapshot | null = null;
  const c = new DictationController({
    createRecognizer: () => { const r = new FakeRec(); recs.push(r); return r; },
    onChange: (s) => { snap = s; },
    onFinalize: (t) => finals.push(t),
    now: () => clock,
    setTimer: (fn) => { timers.push(fn); return timers.length - 1; },
    clearTimer: () => {},
    restartBackoffMs: 10,
    maxMs: opts.maxMs,
  });
  return {
    c, finals,
    cur: () => recs[recs.length - 1]!,
    recCount: () => recs.length,
    flushTimers: () => { const t = timers.splice(0); t.forEach(fn => fn()); },
    tick: (ms: number) => { clock += ms; },
    snap: () => snap!,
  };
}

describe('DictationController', () => {
  it('accumulates final text and shows interim while recording', () => {
    const h = harness();
    h.c.start();
    expect(h.snap().state).toBe('recording');
    h.cur().emit([{ final: true, text: 'hello ' }, { final: false, text: 'wor' }]);
    expect(h.snap().finalText).toBe('hello');
    expect(h.snap().interim).toBe('wor');
  });

  it('a short pause (onend while recording) auto-restarts and preserves text — no finalize', () => {
    const h = harness();
    h.c.start();
    h.cur().emit([{ final: true, text: 'first part ' }]);
    // recognizer ends on a brief silence
    h.cur().onend?.();
    expect(h.finals).toHaveLength(0);          // did NOT deliver
    expect(h.snap().state).toBe('recording');  // still recording
    h.flushTimers();                           // backoff → restart
    expect(h.recCount()).toBe(2);              // new recognizer spawned
    h.cur().emit([{ final: true, text: 'second part' }]);
    expect(h.snap().finalText).toBe('first part second part'); // text preserved across restart
    expect(h.finals).toHaveLength(0);
  });

  it('explicit pause preserves text and does not finalize; resume continues', () => {
    const h = harness();
    h.c.start();
    h.cur().emit([{ final: true, text: 'before pause ' }]);
    h.c.pause();
    expect(h.snap().state).toBe('paused');
    expect(h.snap().finalText).toBe('before pause');
    expect(h.finals).toHaveLength(0);
    h.c.resume();
    expect(h.snap().state).toBe('recording');
    h.cur().emit([{ final: true, text: 'after resume' }]);
    expect(h.snap().finalText).toBe('before pause after resume');
  });

  it('finalizes and delivers only on explicit Stop (including trailing interim)', () => {
    const h = harness();
    h.c.start();
    h.cur().emit([{ final: true, text: 'committed ' }, { final: false, text: 'trailing' }]);
    h.c.stop();
    expect(h.snap().state).toBe('idle');
    expect(h.finals).toEqual(['committed trailing']); // interim not lost
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

  it('mic-denied is fatal: goes idle with an error, no auto-restart, no delivery', () => {
    const h = harness();
    h.c.start();
    h.cur().onerror?.({ error: 'not-allowed' });
    expect(h.snap().state).toBe('idle');
    expect(h.snap().error).toMatch(/mic/i);
    h.flushTimers();
    expect(h.recCount()).toBe(1); // never restarted
    expect(h.finals).toHaveLength(0);
  });

  it('hits the hard safety limit → auto-finalizes and delivers', () => {
    const h = harness({ maxMs: 1000 });
    h.c.start();
    h.cur().emit([{ final: true, text: 'long dictation' }]);
    h.tick(1200); // exceed the safety limit
    h.cur().onend?.(); // next end observes the limit
    expect(h.snap().state).toBe('idle');
    expect(h.finals).toEqual(['long dictation']);
  });

  it('tracks active elapsed time, excluding paused time', () => {
    const h = harness();
    h.c.start();
    h.tick(3000);
    h.c.pause();
    h.tick(5000);      // paused — should not count
    h.c.resume();
    h.tick(2000);
    expect(h.c.snapshot().elapsedMs).toBe(5000); // 3000 + 2000 (live, excludes the 5000 paused)
  });
});
