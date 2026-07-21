import { describe, expect, it } from 'vitest';
import { extractArtifacts, type Message } from '../src/index.js';

const baseMessage: Message = {
  id: 1000,
  type: 'msg',
  name: 'Robin',
  initials: 'RO',
  color: '#000000',
  role: 'host',
  client: 'web',
  text: '',
  time: 1000,
};

describe('extractArtifacts', () => {
  it('extracts supported delivery markers from messages', () => {
    const artifacts = extractArtifacts([
      {
        ...baseMessage,
        text: '[DECISION] Ship the report flow first\n[TODO] Add markdown export',
      },
    ]);

    expect(artifacts).toMatchObject([
      { kind: 'decision', text: 'Ship the report flow first', author: 'Robin' },
      { kind: 'todo', text: 'Add markdown export', author: 'Robin' },
    ]);
  });

  it('ignores system messages and unmarked text', () => {
    const artifacts = extractArtifacts([
      { ...baseMessage, type: 'sys', text: '[RESULT] Hidden' },
      { ...baseMessage, id: 1001, text: 'Plain discussion' },
    ]);

    expect(artifacts).toEqual([]);
  });
});

describe('extractArtifacts marker anchoring (T-71 review-found bug)', () => {
  const msg = (text: string) => ({ id: 1, type: 'msg', name: 'A', initials: 'A', color: '#000', role: '', client: 'cc', text, time: 1 }) as unknown as Message;
  it('inline prose discussing a tag does NOT create an artifact', () => {
    expect(extractArtifacts([msg('Protocol tags may remain [TODO] internally for compatibility.')])).toEqual([]);
  });
  it('a marker at start of message still extracts', () => {
    expect(extractArtifacts([msg('[DECISION] Ship it.')])).toHaveLength(1);
  });
  it('a marker at start of a later line (with indent) still extracts', () => {
    const a = extractArtifacts([msg('Summary first.\n  [RESULT] All green.')]);
    expect(a).toHaveLength(1);
    expect(a[0]!.kind).toBe('result');
  });
  it("a '>'-quoted marker line does not manufacture work", () => {
    expect(extractArtifacts([msg('Replying to this:\n> [TODO] original task text')])).toEqual([]);
  });
  it('multiple line-start markers in one message all extract', () => {
    expect(extractArtifacts([msg('[DECISION] One.\n[TODO] Two.')])).toHaveLength(2);
  });
});
