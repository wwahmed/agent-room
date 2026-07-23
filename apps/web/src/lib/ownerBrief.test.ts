import { describe, it, expect } from 'vitest';
import { buildOwnerBrief, briefToSpeech, type BriefInput } from './ownerBrief.js';

const base: BriefInput = { selfName: 'Waqas', lastSeenTime: 1000, messages: [], tasks: [] };

describe('buildOwnerBrief', () => {
  it('reports only messages AFTER the read marker, excluding your own', () => {
    const lines = buildOwnerBrief({
      ...base,
      messages: [
        { name: 'Alex', time: 500, text: 'old' },      // before marker -> excluded
        { name: 'Alex', time: 1500, text: 'a' },
        { name: 'Alex', time: 1600, text: 'b' },
        { name: 'Waqas', time: 1700, text: 'mine' },    // self -> excluded
        { name: 'UX', time: 1800, text: 'c' },
      ],
    });
    const since = lines.find((l) => l.kind === 'since');
    expect(since?.text).toContain('3 new messages');
    expect(since?.text).toContain('Alex'); // top sender
  });

  it('surfaces items that need the owner, by intent words not guesswork', () => {
    const lines = buildOwnerBrief({
      ...base,
      messages: [{ name: 'Alex', time: 1500 }],
      tasks: [
        { id: 'T-1', title: 'REAL FIX (needs Waqas authorization): rebuild', state: 'todo' },
        { id: 'T-2', title: 'owner pick between A and B', state: 'in_progress' },
        { id: 'T-3', title: 'ordinary build task', state: 'todo' }, // not a blocker
      ],
    });
    const needs = lines.find((l) => l.kind === 'needs');
    expect(needs?.text).toMatch(/Waiting on you: 2 items/);
    expect(needs?.text).toContain('T-1');
  });

  it('never counts done/rejected tasks as needing you', () => {
    const lines = buildOwnerBrief({
      ...base,
      messages: [{ name: 'Alex', time: 1500 }],
      tasks: [{ id: 'T-9', title: 'needs Waqas authorization', state: 'done' }],
    });
    expect(lines.find((l) => l.kind === 'needs')).toBeUndefined();
  });

  it('lists what is building now', () => {
    const lines = buildOwnerBrief({
      ...base,
      messages: [{ name: 'Alex', time: 1500 }],
      tasks: [{ id: 'T-5', title: 'x', state: 'in_progress' }, { id: 'T-6', title: 'y', state: 'in_progress' }],
    });
    expect(lines.find((l) => l.kind === 'building')?.text).toMatch(/Building now: 2 tasks, incl\. T-5/);
  });

  it('says exactly "nothing changed" when there is nothing new, no padding', () => {
    const lines = buildOwnerBrief({ ...base, lastSeenTime: 9999, messages: [{ name: 'Alex', time: 500 }], tasks: [] });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.kind).toBe('none');
    expect(lines[0]!.text).toBe('Nothing has changed since your last visit.');
  });

  it('caps the brief at five lines', () => {
    const lines = buildOwnerBrief({
      ...base,
      messages: [{ name: 'A', time: 1500 }, { name: 'B', time: 1600 }],
      tasks: [
        { id: 'T-1', title: 'needs you', state: 'todo' },
        { id: 'T-2', title: 'in progress a', state: 'in_progress' },
        { id: 'T-3', title: 'done a', state: 'done' },
      ],
    });
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  it('NO READ MARKER: does not report the whole history as new (first-visit framing)', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: 'Alex', time: 100 + i }));
    const lines = buildOwnerBrief({ ...base, lastSeenTime: null, messages: many, tasks: [{ id: 'T-1', title: 'x', state: 'in_progress' }] });
    const since = lines.find((l) => l.kind === 'since');
    expect(since?.text).toMatch(/First time here/);
    expect(since?.text).not.toMatch(/20 new messages/); // must NOT dump all as new
    expect(lines.find((l) => l.kind === 'building')).toBeDefined(); // shows current state instead
  });

  it('NO READ MARKER with no tasks stays honest, not "nothing changed"', () => {
    const lines = buildOwnerBrief({ ...base, lastSeenTime: null, messages: [{ name: 'Alex', time: 100 }], tasks: [] });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toMatch(/First time here.*nothing is waiting on you/);
  });

  it('briefToSpeech flattens to one spoken paragraph', () => {
    const lines = buildOwnerBrief({ ...base, messages: [{ name: 'Alex', time: 1500 }] });
    expect(briefToSpeech(lines)).toContain('1 new message');
    expect(typeof briefToSpeech(lines)).toBe('string');
  });
});
