import { describe, it, expect } from 'vitest';
import { composeBrief, humanizeTitle, stripForSpeech, type BriefProtocolInput, type BriefTask } from '../src/briefProtocol.js';

const base: BriefProtocolInput = { selfName: 'Waqas', firstUnreadIndex: 0, messages: [], tasks: [] };

const task = (id: string, title: string, state: string, owner = 'Claude'): BriefTask => ({ id, title, state, owner });

// A realistic slice of the live board, so the honesty checks bite on real shapes.
const boardSample: BriefTask[] = [
  task('T-134', 'Owner Executive Brief on demand: concise contextual update + speaker/TTS playback', 'done'),
  task('T-140', 'HOTFIX (host report): opening a chat lands at the new-message divider (first unread), not the bottom', 'done'),
  task('T-131', 'REAL FIX (needs Waqas authorization): silent + continuous dictation via MediaRecorder + server-side STT', 'in_progress'),
  task('T-130', 'HOTFIX (host-critical): zero beeps mid-recording — beep only at start and send', 'rejected'),
  task('T-46', 'T-38h: Unify system surfaces, prompts, and overlays', 'awaiting_review'),
  task('T-137', 'Release notes: concise per-version what-changed in the menu, linked from the update banner', 'todo'),
  task('T-95', '[P0 ENTRY GATE 1] Release Safety & Quality Governance', 'in_progress'),
];

describe('humanizeTitle', () => {
  it('strips ID, priority tags, program brackets, slice prefixes, and owner handle', () => {
    expect(humanizeTitle('HOTFIX (host report): opening a chat lands at the new-message divider (@Claude)'))
      .toBe('opening a chat lands at the new-message divider');
    expect(humanizeTitle('T-38h: Unify system surfaces, prompts, and overlays'))
      .toBe('Unify system surfaces, prompts, and overlays');
    expect(humanizeTitle('[P0 ENTRY GATE 1] Release Safety & Quality Governance'))
      .toBe('Release Safety & Quality Governance');
    expect(humanizeTitle('P0: reclaim the phone reading viewport'))
      .toBe('reclaim the phone reading viewport');
  });
  it('never returns empty; falls back to the raw title', () => {
    expect(humanizeTitle('T-99')).toBe('T-99');
  });
  it('strips mid-title task ids and provenance parentheticals (no jargon leak)', () => {
    expect(humanizeTitle('zero beeps mid-recording (supersedes T-76 target)'))
      .toBe('zero beeps mid-recording');
    expect(humanizeTitle('server stamps message envelopes (T-111 sibling)'))
      .toBe('server stamps message envelopes');
  });
});

describe('composeBrief — honesty by construction', () => {
  it('emits NO raw task-id jargon in display or speech', () => {
    const b = composeBrief({ ...base, tasks: boardSample, messages: [{ name: 'Alex', text: 'hi' }], firstUnreadIndex: 0 });
    expect(b.display).not.toMatch(/\bT-\d+\b/);
    expect(b.speech).not.toMatch(/\bT-\d+\b/);
  });

  it('maps board state mechanically: done -> Live, rejected -> Watch, needs-owner -> Decision', () => {
    const b = composeBrief({ ...base, tasks: boardSample, firstUnreadIndex: 0 });
    // done tasks appear as live (by meaning)
    expect(b.sections.live.join(' ')).toContain('opening a chat lands at the new-message divider');
    expect(b.sections.live.join(' ')).toContain('Owner Executive Brief');
    // rejected task appears in watch
    expect(b.sections.watch.join(' ')).toMatch(/zero beeps mid-recording.*rework/i);
    // needs-owner task (title says "needs Waqas authorization") becomes a decision
    expect(b.sections.decisions.some((d) => /dictation/i.test(d.ask))).toBe(true);
  });

  it('does not surface a done or rejected task as a decision', () => {
    const b = composeBrief({ ...base, tasks: boardSample, firstUnreadIndex: 0, mode: 'deep' });
    const askText = b.sections.decisions.map((d) => d.ask).join(' ').toLowerCase();
    expect(askText).not.toContain('divider'); // T-140 is done
    expect(askText).not.toContain('beeps');    // T-130 is rejected
  });

  it('every live line traces to a real done task (no invented shipped work)', () => {
    const b = composeBrief({ ...base, tasks: boardSample, firstUnreadIndex: 0, mode: 'deep' });
    const doneMeanings = boardSample.filter((t) => t.state === 'done').map((t) => humanizeTitle(t.title));
    for (const line of b.sections.live) {
      expect(doneMeanings).toContain(line);
    }
  });

  it('leads with decisions before the delta in the display', () => {
    const b = composeBrief({ ...base, tasks: boardSample, firstUnreadIndex: 0 });
    const dIdx = b.display.indexOf('Decisions waiting on you');
    const sIdx = b.display.indexOf('Since you last checked in');
    expect(dIdx).toBeGreaterThanOrEqual(0);
    expect(sIdx).toBeGreaterThan(dIdx);
  });

  it('says "Nothing needs you" honestly when no task or message asks the owner', () => {
    const b = composeBrief({ ...base, tasks: [task('T-1', 'Refine chat typography', 'done')], firstUnreadIndex: 0 });
    expect(b.display).toContain('Nothing needs you right now');
    expect(b.speech).toContain('Nothing needs your decision right now');
  });

  it('does not promote a greeting/ack or a non-question mention into a decision', () => {
    const b = composeBrief({
      ...base,
      firstUnreadIndex: 0,
      messages: [
        { name: 'UX', text: '@Waqas thanks — the screenshot changes the diagnosis, we adopt it.' }, // ack, has no '?'
        { name: 'UX', text: '@Waqas the /brief command is not wired in yet, it is next in the queue.' }, // status, no '?'
        { name: 'UX', text: '@Waqas got it. Should we default the audio on?' }, // real question -> included
      ],
    });
    const asks = b.sections.decisions.map((d) => d.ask);
    expect(asks.some((a) => /thanks/i.test(a))).toBe(false);
    expect(asks.some((a) => /next in the queue/i.test(a))).toBe(false);
    expect(asks.some((a) => /default the audio on\?/i.test(a))).toBe(true);
  });

  it('produces no doubled sentence punctuation in speech', () => {
    const b = composeBrief({
      ...base,
      tasks: boardSample,
      firstUnreadIndex: 0,
      messages: [{ name: 'UX', text: '@Waqas should we ship it now?' }],
    });
    expect(b.speech).not.toMatch(/\.\./);
    expect(b.speech).not.toMatch(/There are one more/);
  });

  it('only attaches a recommendation when the source states one', () => {
    const withRec = composeBrief({
      ...base,
      firstUnreadIndex: 0,
      messages: [{ name: 'UX-Adversary', text: '@Waqas should we ship the audio variant? I recommend enabling it by default.' }],
    });
    const d = withRec.sections.decisions.find((x) => x.source === 'message');
    expect(d?.recommendation).toMatch(/enabling it by default/i);

    const noRec = composeBrief({
      ...base,
      firstUnreadIndex: 0,
      messages: [{ name: 'UX-Adversary', text: '@Waqas should we ship the audio variant?' }],
    });
    expect(noRec.sections.decisions.find((x) => x.source === 'message')?.recommendation).toBeNull();
  });
});

describe('composeBrief — delta off the read marker', () => {
  it('counts only fresh messages from others', () => {
    const b = composeBrief({
      ...base,
      firstUnreadIndex: 2,
      messages: [
        { name: 'Alex', text: 'seen1' },
        { name: 'Alex', text: 'seen2' },
        { name: 'Alex', text: 'fresh1' },
        { name: 'Waqas', text: 'mine — excluded' },
        { name: 'UX', text: 'fresh2' },
      ],
    });
    expect(b.sections.delta).toContain('2 new messages');
    expect(b.sections.delta).toContain('Alex');
  });

  it('frames a first visit (null marker) without dumping all history as new', () => {
    const b = composeBrief({
      ...base,
      firstUnreadIndex: null,
      messages: [{ name: 'Alex', text: 'a' }, { name: 'Alex', text: 'b' }],
    });
    expect(b.sections.delta).toMatch(/First time here/);
  });

  it('says nothing new honestly when there is no fresh traffic', () => {
    const b = composeBrief({ ...base, firstUnreadIndex: 1, messages: [{ name: 'Alex', text: 'old' }] });
    expect(b.sections.delta).toContain('Nothing new since you last looked');
  });
});

describe('composeBrief — speech rendering', () => {
  it('strips SHAs, URLs, file paths, and task ids from speech', () => {
    const raw = 'Fix is live at commit 0a17e35 see https://x.y/z and .visual-gate/t140.mjs for T-140';
    const spoken = stripForSpeech(raw);
    expect(spoken).not.toMatch(/0a17e35/);
    expect(spoken).not.toMatch(/https?:\/\//);
    expect(spoken).not.toMatch(/\bT-140\b/);
    expect(spoken).not.toMatch(/t140\.mjs/);
  });

  it('carries the SAME decision facts as the display (nothing added or dropped)', () => {
    const b = composeBrief({ ...base, tasks: boardSample, firstUnreadIndex: 0 });
    // Both renderings mention the dictation decision; neither invents one absent from the other.
    expect(b.display.toLowerCase()).toContain('dictation');
    expect(b.speech.toLowerCase()).toContain('dictation');
  });

  it('front-loads decisions in speech (before the delta)', () => {
    const b = composeBrief({ ...base, tasks: boardSample, firstUnreadIndex: 0, messages: [{ name: 'Alex', text: 'x' }] });
    const decIdx = b.speech.toLowerCase().indexOf('waiting on you');
    const deltaIdx = b.speech.indexOf(b.sections.delta.split('.')[0]);
    expect(decIdx).toBeGreaterThanOrEqual(0);
    expect(deltaIdx).toBeGreaterThan(decIdx);
  });
});

describe('composeBrief — deep and topic', () => {
  it('deep expands the decision and live caps', () => {
    const many: BriefTask[] = Array.from({ length: 6 }, (_, i) =>
      task(`T-${200 + i}`, `Feature ${i} needs your decision`, 'todo'));
    const def = composeBrief({ ...base, tasks: many, firstUnreadIndex: 0 });
    const deep = composeBrief({ ...base, tasks: many, firstUnreadIndex: 0, mode: 'deep' });
    expect(def.sections.decisions.length).toBeLessThanOrEqual(3);
    expect(deep.sections.decisions.length).toBeGreaterThan(def.sections.decisions.length);
  });

  it('topic scopes content to the matching workstream', () => {
    const b = composeBrief({ ...base, tasks: boardSample, firstUnreadIndex: 0, topic: 'dictation' });
    // Only dictation-related tasks survive; the divider (done) is filtered out.
    expect(b.sections.live.join(' ')).not.toContain('divider');
    expect(b.sections.decisions.some((d) => /dictation/i.test(d.ask))).toBe(true);
  });
});
