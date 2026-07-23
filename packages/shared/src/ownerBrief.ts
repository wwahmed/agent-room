// T-134: the on-demand owner executive brief — "what changed in THIS room since
// you last looked," for you, five lines at most. Assembled ONLY from real board
// and message state anchored to your account read marker (T-126). The read
// marker is a COUNT of messages already seen (not a timestamp), so "new" is the
// tail of the message list past that index. If nothing has changed it says
// exactly that rather than padding with invented "activity." This is the pure
// assembler; the trigger, render, and local-TTS playback wrap it.

export interface BriefMessage { name: string; text?: string }
export interface BriefTask { id: string; title: string; state: string; owner?: string; verifier?: string }

export interface BriefInput {
  selfName: string;
  /** Count of messages already seen (the account read marker). null = never
   *  looked here (first visit). Messages at index >= this are "new". */
  firstUnreadIndex: number | null;
  messages: BriefMessage[];
  tasks: BriefTask[];
}

export interface BriefLine { kind: 'since' | 'needs' | 'building' | 'done' | 'none'; text: string }

function topSenders(names: string[], max = 2): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  if (ranked.length <= max) return ranked.join(' and ');
  return `${ranked.slice(0, max).join(', ')} and others`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// A task "needs you" when its title explicitly calls for the owner (an
// authorization, decision, or question directed at them). We match on intent
// words rather than guessing, so we never manufacture a blocker.
function needsOwner(t: BriefTask): boolean {
  const s = t.title.toLowerCase();
  if (t.state === 'done' || t.state === 'rejected') return false;
  return /needs?\s+(waqas|you|owner|authoriz)|awaiting\s+(you|owner|authoriz)|owner\s+(pick|decision|ruling)|\bdecision\b|authoriz/.test(s);
}

/**
 * Build the brief as an ordered list of at most five lines. Every line is
 * derived from the inputs; there is no filler. Order: what changed since your
 * last visit, what needs you, what is building now, what just finished.
 */
export function buildOwnerBrief(input: BriefInput): BriefLine[] {
  // No read marker (first visit / a device that never marked read) has no
  // anchor for "since you last looked". We must NOT report the whole history as
  // new — instead say it is a first visit and give the current state.
  const firstVisit = input.firstUnreadIndex == null;
  const seen = Math.max(0, Math.min(input.firstUnreadIndex ?? 0, input.messages.length));
  const fromOthers = input.messages.filter((m) => m.name !== input.selfName);
  const fresh = firstVisit ? [] : input.messages.slice(seen).filter((m) => m.name !== input.selfName);
  const changed = firstVisit || fresh.length > 0;
  const lines: BriefLine[] = [];

  // 1. Since you last looked (or a first-visit framing).
  if (firstVisit) {
    lines.push({ kind: 'since', text: `First time here — ${plural(fromOthers.length, 'message')} in this room so far. Current state:` });
  } else if (fresh.length > 0) {
    lines.push({ kind: 'since', text: `${plural(fresh.length, 'new message')} since your last visit, from ${topSenders(fresh.map((m) => m.name))}.` });
  }

  // 2. Needs you — decisions/authorizations waiting.
  const needs = input.tasks.filter(needsOwner);
  if (needs.length > 0) {
    const head = needs.slice(0, 2).map((t) => t.id).join(', ');
    lines.push({ kind: 'needs', text: `Waiting on you: ${plural(needs.length, 'item')} (${head}${needs.length > 2 ? ', …' : ''}).` });
  }

  // 3. Building now.
  const building = input.tasks.filter((t) => t.state === 'in_progress');
  if (building.length > 0) {
    lines.push({ kind: 'building', text: `Building now: ${plural(building.length, 'task')}${building[0] ? `, incl. ${building[0].id}` : ''}.` });
  }

  // 4. Just finished (verified done) — meaningful when something changed or on
  // a first visit (current state).
  const done = input.tasks.filter((t) => t.state === 'done');
  if (changed && done.length > 0) {
    lines.push({ kind: 'done', text: `${plural(done.length, 'task')} verified done on the board.` });
  }

  // Honest empty states, never padded.
  if (lines.length === 0) {
    lines.push({ kind: 'none', text: 'Nothing has changed since your last visit.' });
  } else if (firstVisit && lines.length === 1) {
    // First visit but nothing else to report (no tasks): keep it honest.
    lines[0] = { kind: 'none', text: `First time here — ${plural(fromOthers.length, 'message')} so far, and nothing is waiting on you.` };
  }

  return lines.slice(0, 5);
}

/** Flatten the brief to a single spoken paragraph for the TTS playback. */
export function briefToSpeech(lines: BriefLine[]): string {
  return lines.map((l) => l.text).join(' ');
}
