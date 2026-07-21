import { describe, expect, it } from 'vitest';
import { windowStats } from './unreadWindow.js';

const msg = (name: string, text = 'hello', extra: Record<string, unknown> = {}) =>
  ({ type: 'msg', client: 'cc', name, text, ...extra });

// T-18/T-20: the refined badge math over a fetched unread window.
describe('windowStats', () => {
  it('subtracts status pings and self-authored messages from unread', () => {
    const fetched = [
      msg('Codex'),
      msg('Codex', 'on it', { metadata: { kind: 'status' } }),
      { type: 'msg', client: 'web', name: 'Waqas', text: 'mine' },
    ];
    expect(windowStats(fetched, 3, 'Waqas')).toEqual({ unread: 1, mentions: 0 });
  });

  it('counts mentions of the viewer among real unread messages only', () => {
    const fetched = [
      msg('Codex', '@Waqas please retest'),
      msg('Codex', '@Waqas ping', { metadata: { kind: 'status' } }),
      msg('Claude', 'no mention here'),
    ];
    expect(windowStats(fetched, 3, 'Waqas')).toEqual({ unread: 2, mentions: 1 });
  });

  it('treats the un-fetched remainder of a capped window as ordinary unread', () => {
    const fetched = [msg('Codex', 'on it', { metadata: { kind: 'status' } })];
    // span 100, only 1 fetched: the 99 unseen messages stay counted.
    expect(windowStats(fetched, 100, 'Waqas')).toEqual({ unread: 99, mentions: 0 });
  });

  it('never returns negative unread', () => {
    const fetched = [msg('Codex', 'x', { metadata: { kind: 'status' } })];
    expect(windowStats(fetched, 1, 'Waqas').unread).toBe(0);
  });
});
