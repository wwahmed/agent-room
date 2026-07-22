import { describe, expect, it } from 'vitest';
import type { Message } from '@agent-room/shared';
import { mergeMessages } from './messageMerge.js';

const msg = (id: number, over: Partial<Message> = {}): Message => ({
  id,
  type: 'msg',
  name: 'AgentPeer',
  initials: 'AP',
  color: '#7c5cff',
  role: '',
  text: `message ${id}`,
  client: 'cc',
  time: id,
  ...over,
});

const ids = (list: Message[]) => list.map(m => m.id);

// T-105: the feed's order must be independent of fetch ARRIVAL order. These
// are the deterministic race cases from the incident and the DoD matrix,
// expressed at the merge boundary every ingest path now goes through.
describe('T-105 mergeMessages — order-preserving, race-immune ingest', () => {
  it('THE INCIDENT: a stale pull resolving after a resume refresh cannot append old rows to the live tail', () => {
    // Tab resumed: forceRefresh anchored the window at the newest page.
    const afterRefresh = [msg(100), msg(101), msg(102)];
    // The focus-debounced pull, started before backgrounding, finally
    // resolves with rows from a day earlier.
    const staleFetch = [msg(10), msg(11)];
    const merged = mergeMessages(afterRefresh, staleFetch);
    expect(ids(merged)).toEqual([10, 11, 100, 101, 102]);
    // The live tail is STILL the newest message — never the stale rows.
    expect(merged.at(-1)!.id).toBe(102);
  });

  it('out-of-order page fetches converge to one timeline regardless of interleaving', () => {
    const pageA = [msg(1), msg(2)];
    const pageB = [msg(3), msg(4)];
    const pageC = [msg(5), msg(6)];
    const order1 = mergeMessages(mergeMessages(pageC, pageA), pageB);
    const order2 = mergeMessages(mergeMessages(pageA, pageB), pageC);
    const order3 = mergeMessages(mergeMessages(pageB, pageC), pageA);
    expect(ids(order1)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ids(order2)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ids(order3)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('never loses and never duplicates across overlapping fetches', () => {
    const existing = [msg(1), msg(2), msg(3)];
    const overlapping = [msg(2), msg(3), msg(4)];
    const merged = mergeMessages(existing, overlapping);
    expect(ids(merged)).toEqual([1, 2, 3, 4]);
  });

  it('replaces the optimistic local copy with the server copy of the same id', () => {
    const optimistic = msg(50, { text: 'local echo', metadata: undefined });
    const serverCopy = msg(50, { text: 'local echo', metadata: { modeAtSend: 'open' } });
    const merged = mergeMessages([msg(49), optimistic], [serverCopy]);
    expect(merged.find(m => m.id === 50)!.metadata?.modeAtSend).toBe('open');
    expect(merged).toHaveLength(2);
  });

  it('upward pagination prepends by id, not by call order', () => {
    const window = [msg(20), msg(21)];
    const olderPage = [msg(18), msg(19)];
    expect(ids(mergeMessages(window, olderPage))).toEqual([18, 19, 20, 21]);
  });

  it('returns the same array when the fetch brings nothing (no spurious re-render)', () => {
    const existing = [msg(1)];
    expect(mergeMessages(existing, [])).toBe(existing);
  });
});
