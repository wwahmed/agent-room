// T-35: what a board MUTATION should hand back.
//
// createTask/claimTask/submitTask/verifyTask each returned `{ task, board }`
// with the ENTIRE board attached — every task, every evidence block. Evidence is
// deliberately verbose (file listings, diffs, full run output), so on a mature
// board the reply to "create one task" measured 92,000-106,000 characters across
// 600+ lines and blew past the caller's tool-result budget. Observed six times in
// one session: every single board write failed to return usable output, and the
// only way through was to re-issue the call as raw HTTP and grep the persisted
// result file. The board write itself always succeeded, which made it worse — the
// agent could not tell an over-budget reply from a failure without going and
// looking.
//
// Nobody asked for the board here. The caller asked to change one task, so the
// reply is that task plus enough shape to orient: counts per state and a
// one-line index. `room_task_list` is untouched and still returns everything,
// because a verifier ruling on a submission genuinely needs the evidence — this
// trims only the replies that were carrying it uninvited.

export interface DigestTask {
  id: string;
  state: string;
  title: string;
  owner?: string;
  verifier?: string;
  /** T-28: kept in the digest because "is it live" is the question a board
   *  reader most often has next, and a SHA is a handful of characters. */
  liveRef?: string;
}

export interface BoardDigest {
  counts: Record<string, number>;
  total: number;
  tasks: DigestTask[];
}

interface TaskLike {
  id?: unknown;
  state?: unknown;
  title?: unknown;
  owner?: unknown;
  verifier?: unknown;
  liveRef?: unknown;
}

const str = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
};

/**
 * Evidence-free projection of a board. Titles are capped: a digest exists to
 * stay small, and one pathological title must not undo that.
 */
export function boardDigest(board: { tasks?: unknown } | null | undefined): BoardDigest {
  const tasks = Array.isArray(board?.tasks) ? (board!.tasks as TaskLike[]) : [];
  const counts: Record<string, number> = {};
  const digest: DigestTask[] = [];
  for (const t of tasks) {
    const state = str(t?.state) ?? 'unknown';
    counts[state] = (counts[state] ?? 0) + 1;
    digest.push({
      id: str(t?.id) ?? '',
      state,
      title: (str(t?.title) ?? '').slice(0, 120),
      ...(str(t?.owner) ? { owner: str(t?.owner)! } : {}),
      ...(str(t?.verifier) ? { verifier: str(t?.verifier)! } : {}),
      ...(str(t?.liveRef) ? { liveRef: str(t?.liveRef)!.slice(0, 80) } : {}),
    });
  }
  return { counts, total: tasks.length, tasks: digest };
}
