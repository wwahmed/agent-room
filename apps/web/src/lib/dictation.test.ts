import { describe, expect, it } from 'vitest';
import { DictationController, mergeTranscript, type RecognizerLike, type DictationSnapshot } from './dictation.js';

// Fake SpeechRecognition: the test drives onresult/onend/onerror. stop()/abort()
// fire onend synchronously, mirroring how the browser ends a session. An
// optional `failStart` makes start() throw synchronously.
class FakeRec implements RecognizerLike {
  lang = ''; continuous = false; interimResults = false;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  started = false; stopped = false; aborted = false;
  beforeStop: (() => void) | null = null;
  constructor(private failStart = false) {}
  start() { if (this.failStart) throw new Error('start failed'); this.started = true; }
  stop() { this.stopped = true; this.beforeStop?.(); this.onend?.(); }
  abort() { this.aborted = true; this.onend?.(); }
  emit(items: Array<{ final: boolean; text: string }>) {
    const results: any = items.map(it => ({ isFinal: it.final, 0: { transcript: it.text } }));
    results.length = items.length;
    this.onresult?.({ resultIndex: 0, results });
  }
}

function harness(opts: { maxMs?: number; failStartAll?: boolean; minRestartIntervalMs?: number; restartOnPause?: boolean } = {}) {
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
    // T-76: existing tests exercise fast auto-restart; keep the coalescing
    // interval small here so restart timers stay in the flushRestarts band.
    // The dedicated beep-coalescing test below uses a realistic interval.
    minRestartIntervalMs: opts.minRestartIntervalMs ?? 10,
    restartOnPause: opts.restartOnPause,
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

  it('does not accumulate progressively replayed interim phrases across restarts', () => {
    const h = harness();
    h.c.start();
    h.cur().emit([{ final: false, text: 'this is' }]);
    h.cur().onend?.();
    h.flushRestarts();
    h.cur().emit([{ final: false, text: 'this is my text' }]);
    h.c.stop();
    expect(h.finals).toEqual(['this is my text']);
  });

  it('T-107: interim words survive an automatic restart when the next generation does NOT replay them (desktop)', () => {
    // Desktop Chrome holds a whole utterance as interim, ends on silence, and
    // the fresh generation starts empty. Before the fix, the new generation's
    // first result replaced the un-committed interim and the entire first
    // sentence vanished from the draft.
    const h = harness();
    h.c.start();
    h.cur().emit([{ final: false, text: 'first sentence spoken on desktop' }]);
    h.cur().onend?.(); // silence timeout, not a user stop
    h.flushRestarts();
    h.cur().emit([{ final: false, text: 'second thought' }]);
    expect(mergeTranscript(h.snap().finalText, h.snap().interim))
      .toBe('first sentence spoken on desktop second thought');
    h.c.stop();
    expect(h.finals).toEqual(['first sentence spoken on desktop second thought']);
  });

  it('T-107: a restart with nothing spoken afterwards still finalizes the carried words on Stop', () => {
    const h = harness();
    h.c.start();
    h.cur().emit([{ final: false, text: 'only sentence' }]);
    h.cur().onend?.();
    h.flushRestarts();
    h.c.stop(); // no results in the second generation at all
    expect(h.finals).toEqual(['only sentence']);
  });

  it('T-108: exposes no-signal diagnostics — hasHeardSpeech, restarts, lastTransientError', () => {
    const h = harness();
    h.c.start();
    expect(h.snap().hasHeardSpeech).toBe(false);
    expect(h.snap().restarts).toBe(0);
    // transient error records its code without killing the session
    h.cur().onerror?.({ error: 'no-speech' });
    expect(h.snap().lastTransientError).toBe('no-speech');
    expect(h.snap().state).toBe('recording');
    // silent restart loop counts
    h.cur().onend?.();
    h.flushRestarts();
    h.cur().onend?.();
    h.flushRestarts();
    expect(h.snap().restarts).toBe(2);
    expect(h.snap().hasHeardSpeech).toBe(false);
    // the first real result flips hasHeardSpeech
    h.cur().emit([{ final: false, text: 'finally' }]);
    expect(h.snap().hasHeardSpeech).toBe(true);
    // a new session resets all three
    h.c.stop();
    h.c.start();
    expect(h.snap().hasHeardSpeech).toBe(false);
    expect(h.snap().restarts).toBe(0);
    expect(h.snap().lastTransientError).toBe(null);
  });

  it('collapses Android cumulative final results instead of concatenating every hypothesis', () => {
    const h = harness();
    h.c.start();
    h.cur().emit([
      { final: true, text: 'this' },
      { final: true, text: 'this is' },
      { final: true, text: 'this is a test' },
    ]);
    expect(h.snap().finalText).toBe('this is a test');
    h.c.stop();
    expect(h.finals).toEqual(['this is a test']);
  });

  it('collapses a cumulative final phrase replayed after an automatic restart', () => {
    const h = harness();
    h.c.start();
    h.cur().emit([{ final: true, text: 'this is' }]);
    h.cur().onend?.();
    h.flushRestarts();
    h.cur().emit([{ final: true, text: 'this is a test of the mic' }]);
    expect(h.snap().finalText).toBe('this is a test of the mic');
    h.c.stop();
    expect(h.finals).toEqual(['this is a test of the mic']);
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

  it('does not double-commit when stop triggers a late cumulative final result', () => {
    const h = harness();
    h.c.start();
    h.cur().emit([{ final: true, text: 'this is my' }]);
    h.cur().beforeStop = () => h.cur().emit([{ final: true, text: 'this is my text' }]);
    h.c.stop();
    expect(h.finals).toEqual(['this is my text']);
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

  it('network failure is fatal and visible instead of silently restarting forever', () => {
    const h = harness();
    h.c.start();
    h.cur().onerror?.({ error: 'network' });
    expect(h.snap().state).toBe('idle');
    expect(h.snap().error).toMatch(/service|connection/i);
    h.flushRestarts();
    expect(h.recCount()).toBe(1);
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
    // FIRE the resumed deadline (not an explicit stop): it must auto-finalize exactly once.
    h.flushDeadline();
    expect(h.snap().state).toBe('idle');
    expect(h.finals).toEqual(['kept more']); // one auto-finalization
    h.flushDeadline();                        // any stale timer flushed again must NOT re-deliver
    expect(h.finals).toEqual(['kept more']); // still exactly one
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

describe('mergeTranscript', () => {
  it('prefers longer cumulative hypotheses and removes word-boundary overlap', () => {
    expect(mergeTranscript('this is', 'this is a test')).toBe('this is a test');
    expect(mergeTranscript('this is a test', 'a test of the mic')).toBe('this is a test of the mic');
  });

  it('still appends unrelated sequential phrases', () => {
    expect(mergeTranscript('hello there', 'general kenobi')).toBe('hello there general kenobi');
  });
});

// T-76: on Android the OS plays a "listening" beep on every SpeechRecognition
// start(), and the recognizer ends on natural pauses. A per-onend restart
// therefore beeps on every pause/partial. The fix coalesces restarts so start()
// (the beep trigger) is spaced by minRestartIntervalMs, keeping the beep near
// the genuine start/stop instead of firing on every pause. These tests spy on
// start() calls with a clock-aware timer model.
describe('T-76: dictation restart beeps do not fire on every pause', () => {
  function beepHarness(minRestartIntervalMs: number) {
    const recs: FakeRec[] = [];
    const startTimes: number[] = [];
    const timers: Array<{ fireAt: number; fn: () => void; done: boolean }> = [];
    let clock = 0;
    let beeps = 0;
    class SpyRec extends FakeRec {
      start() { super.start(); beeps++; startTimes.push(clock); }
    }
    const c = new DictationController({
      createRecognizer: () => { const r = new SpyRec(); recs.push(r); return r; },
      onChange: () => {}, onFinalize: () => {},
      now: () => clock,
      setTimer: (fn, ms) => { const id = timers.length; timers.push({ fireAt: clock + ms, fn, done: false }); return id; },
      clearTimer: (id) => { const t = timers[id as number]; if (t) t.done = true; },
      restartBackoffMs: 250,
      minRestartIntervalMs,
      maxMs: 5 * 60 * 1000,
    });
    const runUntil = (t: number) => {
      let guard = 0;
      for (;;) {
        if (guard++ > 100000) throw new Error('timer loop');
        const due = timers.filter(x => !x.done && x.fireAt <= t).sort((a, b) => a.fireAt - b.fireAt)[0];
        if (!due) break;
        clock = due.fireAt; due.done = true; due.fn();
      }
      clock = t;
    };
    return { c, recs, beeps: () => beeps, startTimes, clock: () => clock, runUntil, live: () => recs[recs.length - 1]! };
  }

  it('an immediate pause does NOT beep again until a full restart interval passes', () => {
    const h = beepHarness(1500);
    h.c.start();
    expect(h.beeps()).toBe(1);          // genuine start beep
    h.live().onend?.();                  // recognizer ends instantly (pause)
    h.runUntil(1499);
    expect(h.beeps()).toBe(1);          // still one — the restart is held back
    h.runUntil(1500);
    expect(h.beeps()).toBe(2);          // exactly one restart after the interval
  });

  it('baseline (no coalescing) beeps right after a pause — proving the fix is load-bearing', () => {
    const b = beepHarness(250);          // interval == backoff ≈ pre-fix behavior
    b.c.start();
    b.live().onend?.();
    b.runUntil(250);
    expect(b.beeps()).toBe(2);          // beeps almost immediately on the pause
  });

  it('a burst of rapid pauses collapses to a handful of beeps, not one per pause', () => {
    const h = beepHarness(1500);
    h.c.start();
    // The recognizer keeps ending ~30ms after each (re)start, 20 times over ~3s.
    for (let step = 0; step <= 100; step++) {
      h.runUntil(step * 30);
      const rec = h.live();
      if (rec && rec.started && !rec.stopped && !(rec as unknown as { _ended?: boolean })._ended) {
        (rec as unknown as { _ended?: boolean })._ended = true;
        rec.emit([{ final: true, text: `word${h.beeps()} ` }]);
        rec.onend?.();                   // pause
      }
    }
    h.runUntil(3000);
    // 20+ pause events over 3s, but starts are spaced >= 1500ms → at most 3 beeps.
    expect(h.beeps()).toBeLessThanOrEqual(3);
    // consecutive starts are genuinely spaced by the interval (no machine-gun).
    for (let i = 1; i < h.startTimes.length; i++) {
      expect(h.startTimes[i]! - h.startTimes[i - 1]!).toBeGreaterThanOrEqual(1500 - 1);
    }
    // transcript still accumulated across the coalesced restarts (no T-120 loss).
    expect(h.c.snapshot().finalText.length).toBeGreaterThan(0);
  });

  it('a genuinely NEW recording after stop still beeps (coalescing never silences a real start)', () => {
    const h = beepHarness(1500);
    h.c.start();
    expect(h.beeps()).toBe(1);
    h.runUntil(100);
    h.c.stop();                          // finishes the session
    h.runUntil(200);
    h.c.start();                         // a distinct new recording
    expect(h.beeps()).toBe(2);          // the new start is not suppressed
  });
});

// T-130 (host ruling): on mobile the OS beeps on every recognizer start, so
// restarting mid-recording beeps through the user's speech. With
// restartOnPause=false the mic session starts EXACTLY ONCE (one beep at start,
// none mid-recording); a premature end finalizes the draft instead of
// restarting, and nothing spoken is lost.
describe('T-130: no mid-recording restart (mobile) means no mid-recording beeps', () => {
  it('a premature end FINALIZES instead of restarting — start() fired exactly once', () => {
    const h = harness({ restartOnPause: false });
    h.c.start();
    expect(h.recCount()).toBe(1);               // one mic session start = one beep
    h.cur().emit([{ final: true, text: 'first part ' }, { final: false, text: 'second part' }]);
    h.cur().onend?.();                           // a pause / silence ends the session
    // No restart: the session count stays 1 (no second beep) and it finalized.
    expect(h.recCount()).toBe(1);
    expect(h.snap().state).toBe('idle');
    // Nothing spoken is lost — the interim tail is merged into the final draft.
    expect(h.finals).toEqual(['first part second part']);
  });

  it('even repeated premature ends never trigger a second start()', () => {
    const h = harness({ restartOnPause: false });
    h.c.start();
    h.cur().emit([{ final: true, text: 'words' }]);
    h.cur().onend?.();
    // the finalized session is idle; further stray events do nothing
    h.cur().onend?.();
    h.flushRestarts();
    expect(h.recCount()).toBe(1);               // still one — no beep after the first
  });

  it('desktop default (restartOnPause=true) still restarts across a pause (T-107 intact)', () => {
    const h = harness();                        // default true
    h.c.start();
    h.cur().emit([{ final: true, text: 'keep going' }]);
    h.cur().onend?.();
    h.flushRestarts();
    expect(h.recCount()).toBe(2);               // restarted — desktop keeps the draft alive
    expect(h.snap().state).toBe('recording');
  });
});
