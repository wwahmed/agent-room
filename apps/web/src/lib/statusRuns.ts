import type { Message } from '@agent-room/shared';
import { isStatusPing } from './unread.js';

// T-72: consecutive status pings from the same sender collapse into ONE
// Activity Note anchored at the newest ping ("3 updates"), instead of a
// stack of near-identical heartbeat rows. A run breaks on any intervening
// non-status message, a different sender, or a different client.

export interface StatusRunView {
  /** ids of run members that must NOT render as standalone rows. */
  hidden: Set<number>;
  /** id of a run's newest member -> the whole run, oldest first (length >= 2). */
  runs: Map<number, Message[]>;
}

export function collapseStatusRuns(messages: Message[]): StatusRunView {
  const hidden = new Set<number>();
  const runs = new Map<number, Message[]>();
  let run: Message[] = [];

  const flush = () => {
    if (run.length > 1) {
      const newest = run[run.length - 1]!;
      runs.set(newest.id, run.slice());
      for (const m of run.slice(0, -1)) hidden.add(m.id);
    }
    run = [];
  };

  for (const m of messages) {
    if (m.type === 'msg' && isStatusPing(m)) {
      const prev = run[run.length - 1];
      if (prev && (prev.name !== m.name || prev.client !== m.client)) flush();
      run.push(m);
    } else {
      flush();
    }
  }
  flush();
  return { hidden, runs };
}
