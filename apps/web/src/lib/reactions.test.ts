import { describe, it, expect } from 'vitest';
import type { Message } from '@agent-room/shared';
import { applyReactionEvents, ownReaction } from './reactions.js';

const msg = (id: number, over: Partial<Message> = {}): Message => ({
  id,
  type: 'msg',
  name: 'Claude',
  initials: 'CL',
  color: '#0EA5E9',
  role: '',
  text: `message ${id}`,
  client: 'cc',
  time: id,
  ...over,
});

const reactionEvent = (targetMessageId: number, snapshot: Message['reactions']): Message => ({
  id: targetMessageId + 1000,
  type: 'sys',
  name: 'system',
  initials: 'SY',
  color: '#64748b',
  role: '',
  text: 'Waqas acknowledged ...',
  client: 'cc',
  time: targetMessageId + 1000,
  metadata: {
    eventType: 'reaction',
    targetMessageId,
    reactionKind: 'ack',
    reactionRemoved: false,
    reactionsSnapshot: snapshot,
  },
});

describe('T-121 applyReactionEvents — chip patches over an append-only cursor', () => {
  it('patches the target message with the snapshot', () => {
    const snapshot = [{ kind: 'ack' as const, name: 'Waqas', client: 'web' as const, time: 9 }];
    const out = applyReactionEvents([msg(1), msg(2)], [reactionEvent(1, snapshot)]);
    expect(out[0]!.reactions).toEqual(snapshot);
    expect(out[1]!.reactions).toBeUndefined();
  });

  it('later events win for the same target (snapshot, not delta)', () => {
    const first = [{ kind: 'ack' as const, name: 'Waqas', client: 'web' as const, time: 9 }];
    const second: Message['reactions'] = [];
    const out = applyReactionEvents([msg(1)], [reactionEvent(1, first), reactionEvent(1, second)]);
    expect(out[0]!.reactions).toEqual([]);
  });

  it('ignores events for messages outside the loaded window', () => {
    const input = [msg(1)];
    const out = applyReactionEvents(input, [reactionEvent(42, [])]);
    expect(out).toBe(input); // no patch → same array identity, no re-render
  });

  it('ignores non-reaction sys rows and malformed events', () => {
    const bare: Message = { ...reactionEvent(1, []), metadata: { eventType: 'reaction' } };
    const input = [msg(1)];
    expect(applyReactionEvents(input, [bare])).toBe(input);
  });
});

describe('T-121 ownReaction', () => {
  it('finds the viewer web-identity reaction only', () => {
    const m = msg(1, {
      reactions: [
        { kind: 'ack', name: 'Waqas', client: 'cc', time: 1 },
        { kind: 'reject', name: 'Waqas', client: 'web', time: 2 },
      ],
    });
    expect(ownReaction(m, 'Waqas')?.kind).toBe('reject');
    expect(ownReaction(m, 'Codex')).toBeUndefined();
    expect(ownReaction(m, undefined)).toBeUndefined();
  });
});
