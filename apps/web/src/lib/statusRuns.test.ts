import { describe, expect, it } from 'vitest';
import type { Message } from '@agent-room/shared';
import { collapseStatusRuns } from './statusRuns.js';

let nextId = 1;
function msg(over: Partial<Message>): Message {
  return {
    id: nextId++,
    type: 'msg',
    name: 'Codex',
    initials: 'CO',
    color: '#000',
    role: '',
    client: 'cc',
    text: 'ping',
    time: nextId,
    ...over,
  } as Message;
}
const status = (over: Partial<Message> = {}) =>
  msg({ metadata: { kind: 'status' } as unknown as Message['metadata'], ...over });

describe('collapseStatusRuns (T-72)', () => {
  it('collapses a same-sender heartbeat run behind its newest member', () => {
    const a = status(); const b = status(); const c = status();
    const { hidden, runs } = collapseStatusRuns([a, b, c]);
    expect(hidden).toEqual(new Set([a.id, b.id]));
    expect(runs.get(c.id)?.map(m => m.id)).toEqual([a.id, b.id, c.id]);
  });

  it('a single status ping stays standalone: nothing hidden, no run', () => {
    const a = status();
    const { hidden, runs } = collapseStatusRuns([msg({}), a, msg({})]);
    expect(hidden.size).toBe(0);
    expect(runs.size).toBe(0);
  });

  it('a normal message between pings breaks the run', () => {
    const a = status(); const chat = msg({}); const b = status();
    const { hidden, runs } = collapseStatusRuns([a, chat, b]);
    expect(hidden.size).toBe(0);
    expect(runs.size).toBe(0);
  });

  it('a different sender breaks the run without swallowing their ping', () => {
    const a = status(); const b = status();
    const other = status({ name: 'Claude' });
    const { hidden, runs } = collapseStatusRuns([a, b, other]);
    expect(hidden).toEqual(new Set([a.id]));
    expect(runs.get(b.id)?.length).toBe(2);
    expect(hidden.has(other.id)).toBe(false);
  });

  it('same name on a different client is a different agent, run breaks', () => {
    const a = status(); const b = status({ client: 'web' });
    const { hidden, runs } = collapseStatusRuns([a, b]);
    expect(hidden.size).toBe(0);
    expect(runs.size).toBe(0);
  });

  it('a trailing run at the end of the feed still collapses', () => {
    const a = status(); const b = status();
    const { runs } = collapseStatusRuns([msg({}), a, b]);
    expect(runs.get(b.id)?.length).toBe(2);
  });
});
