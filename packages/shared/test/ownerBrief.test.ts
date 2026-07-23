import { describe, it, expect } from 'vitest';
import { buildOwnerBrief, briefToSpeech, type BriefInput } from '../src/ownerBrief.js';

const base: BriefInput = { selfName: 'Waqas', firstUnreadIndex: 0, messages: [], tasks: [] };

describe('buildOwnerBrief', () => {
  it('reports only messages PAST the read-marker index, excluding your own', () => {
    const lines = buildOwnerBrief({
      ...base,
      firstUnreadIndex: 2, // first 2 messages already seen
      messages: [
        { name: 'Alex', text: 'old' },   // index 0, seen
        { name: 'Alex', text: 'old2' },  // index 1, seen
        { name: 'Alex', text: 'a' },     // index 2, new
        { name: 'Waqas', text: 'mine' }, // index 3, new but self -> excluded
        { name: 'UX', text: 'c' },       // index 4, new
      ],
    });
    const since = lines.find((l) => l.kind === 'since');
    expect(since?.text).toContain('2 new messages');
    expect(since?.text).toContain('Alex');
  });

  it('surfaces items that need the owner, by intent words not guesswork', () => {
    const lines = buildOwnerBrief({
      ...base,
      messages: [{ name: 'Alex' }, { name: 'Alex' }], firstUnreadIndex: 1,
      tasks: [
        { id: 'T-1', title: 'REAL FIX (needs Waqas authorization): rebuild', state: 'todo' },
        { id: 'T-2', title: 'owner pick between A and B', state: 'in_progress' },
        { id: 'T-3', title: 'ordinary build task', state: 'todo' },
      ],
    });
    const needs = lines.find((l) => l.kind === 'needs');
    expect(needs?.text).toMatch(/Waiting on you: 2 items/);
    expect(needs?.text).toContain('T-1');
  });

  it('never counts done/rejected tasks as needing you', () => {
    const lines = buildOwnerBrief({
      ...base,
      messages: [{ name: 'Alex' }, { name: 'Alex' }], firstUnreadIndex: 1,
      tasks: [{ id: 'T-9', title: 'needs Waqas authorization', state: 'done' }],
    });
    expect(lines.find((l) => l.kind === 'needs')).toBeUndefined();
  });

  it('lists what is building now', () => {
    const lines = buildOwnerBrief({
      ...base,
      messages: [{ name: 'Alex' }, { name: 'Alex' }], firstUnreadIndex: 1,
      tasks: [{ id: 'T-5', title: 'x', state: 'in_progress' }, { id: 'T-6', title: 'y', state: 'in_progress' }],
    });
    expect(lines.find((l) => l.kind === 'building')?.text).toMatch(/Building now: 2 tasks, incl\. T-5/);
  });

  it('says exactly "nothing changed" when nothing is past the marker, no padding', () => {
    const lines = buildOwnerBrief({ ...base, firstUnreadIndex: 1, messages: [{ name: 'Alex' }], tasks: [] });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.kind).toBe('none');
    expect(lines[0]!.text).toBe('Nothing has changed since your last visit.');
  });

  it('NO READ MARKER: does not report the whole history as new (first-visit framing)', () => {
    const many = Array.from({ length: 20 }, () => ({ name: 'Alex' }));
    const lines = buildOwnerBrief({ ...base, firstUnreadIndex: null, messages: many, tasks: [{ id: 'T-1', title: 'x', state: 'in_progress' }] });
    const since = lines.find((l) => l.kind === 'since');
    expect(since?.text).toMatch(/First time here/);
    expect(since?.text).not.toMatch(/20 new messages/);
    expect(lines.find((l) => l.kind === 'building')).toBeDefined();
  });

  it('NO READ MARKER with no tasks stays honest, not "nothing changed"', () => {
    const lines = buildOwnerBrief({ ...base, firstUnreadIndex: null, messages: [{ name: 'Alex' }], tasks: [] });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toMatch(/First time here.*nothing is waiting on you/);
  });

  it('caps the brief at five lines', () => {
    const lines = buildOwnerBrief({
      ...base,
      firstUnreadIndex: 0,
      messages: [{ name: 'A' }, { name: 'B' }],
      tasks: [
        { id: 'T-1', title: 'needs you', state: 'todo' },
        { id: 'T-2', title: 'in progress a', state: 'in_progress' },
        { id: 'T-3', title: 'done a', state: 'done' },
      ],
    });
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  it('briefToSpeech flattens to one spoken paragraph', () => {
    const lines = buildOwnerBrief({ ...base, firstUnreadIndex: 0, messages: [{ name: 'Alex' }] });
    expect(briefToSpeech(lines)).toContain('1 new message');
    expect(typeof briefToSpeech(lines)).toBe('string');
  });
});
