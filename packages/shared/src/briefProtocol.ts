// T-139: the owner brief AS A COMMAND (/brief, /brief-with-audio). This is the
// server-side composer — the "reliable floor" the room agreed on: it answers
// even when no agent is listening, and it is HONEST BY CONSTRUCTION because it
// can only emit what the real board and messages contain. It supersedes the
// T-134 button surface (buildOwnerBrief) and its terse, ID-dumping output.
//
// The protocol (adopted in-room, action-first ordering):
//   1. Decisions waiting on YOU   — numbered, each with a recommended option
//                                    WHEN the source material states one.
//   2. Since you last checked in  — the delta off the account read marker (T-126).
//   3. Live now                   — shipped AND verifier-ruled done.
//   4. Watch                      — what is stuck (rejected) or claimed-not-checked.
//   5. Next                       — one line toward the next deploy.
// Lead with the owner's flagged priority when they stated one.
//
// Truth mapping is mechanical so the verifier can diff it line by line:
//   done                       -> LIVE + verified
//   in_progress/awaiting_review-> in progress / claimed-not-yet-checked
//   a task whose title asks for the owner -> a DECISION WAITING
// Work is named by MEANING, never by "T-NNN" (which is meaningless to the owner).
//
// Two renderings are produced from the same facts: `display` (markdown, bolds the
// asks) and `speech` (speech-optimized — SHAs/URLs/IDs stripped, short declarative
// sentences, front-loaded). Same facts, nothing added or dropped between them.

import type { BriefMessage, BriefTask } from './ownerBrief.js';

export type { BriefMessage, BriefTask };

export interface BriefProtocolInput {
  selfName: string;
  /** Count of messages already seen (the account read marker). null = first visit. */
  firstUnreadIndex: number | null;
  messages: BriefMessage[];
  tasks: BriefTask[];
  /** 'deep' expands each section; default keeps it to ~6 lines. */
  mode?: 'default' | 'deep';
  /** Scope the brief to one workstream: only content whose text matches is kept. */
  topic?: string;
}

export interface BriefDecision {
  /** The real ask, named by meaning. */
  ask: string;
  /** A recommended option ONLY when the source material stated one; else null. */
  recommendation: string | null;
  /** Where this came from, so the verifier can trace it: 'task:T-12' or 'message'. */
  source: string;
}

export interface ComposedBrief {
  display: string;
  speech: string;
  /** Structured sections, exposed so a verifier can diff each claim vs the board. */
  sections: {
    priority: string | null;
    decisions: BriefDecision[];
    delta: string;
    live: string[];
    watch: string[];
    next: string | null;
  };
}

const OWNER_ALIASES = ['waqas', 'you', 'owner', 'host', 'stakeholder'];

/** Strip the ID, priority tags, program brackets, slice prefixes, and trailing
 *  owner handle from a task title, leaving the human meaning. Never invents —
 *  only removes cruft that is noise to the owner. */
export function humanizeTitle(title: string): string {
  let s = title;
  // Trailing "(@Claude)" owner handle.
  s = s.replace(/\s*\(@[^)]+\)\s*$/, '');
  // Leading bracket programs: "[P0 ENTRY GATE 1] ", "[T-97 DESIGN EPIC] ".
  s = s.replace(/^\s*\[[^\]]+\]\s*/, '');
  // Leading slice ids: "T-38b: ", and bare leading "T-140 ".
  s = s.replace(/^\s*T-\d+[a-z]?\s*:\s*/i, '');
  s = s.replace(/^\s*T-\d+\s+/i, '');
  // Leading priority / kind tags up to the first colon, e.g.
  // "HOTFIX (host report): ", "P0: ", "URGENT HOTFIX (host): ", "Urgent: ".
  s = s.replace(/^\s*(urgent\s+)?(hotfix|p0|p1|p2|emergency|urgent|board defect|real fix)\b[^:]*:\s*/i, '');
  // A second pass catches "P0 incident: " style double tags.
  s = s.replace(/^\s*(p0|p1|p2)\b[^:]*:\s*/i, '');
  // Provenance parentheticals are noise to the owner and carry task ids:
  // "(supersedes T-76 target)", "(see T-42)", "(T-111 sibling)". Drop any
  // parenthetical that contains a task id wholesale, plus common provenance words.
  s = s.replace(/\s*\([^)]*\bT-\d+[a-z]?\b[^)]*\)/gi, '');
  s = s.replace(/\s*\((?:supersedes?|supersed|see|ref|cf|per)\b[^)]*\)/gi, '');
  // Strip any residual STANDALONE task-id token so no "T-NNN" jargon ever reaches
  // the owner, then tidy the seams (empty parens, doubled spaces, space-before-punct).
  s = s.replace(/\bT-\d+[a-z]?\b/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([),.;:])/g, '$1')
    .replace(/\(\s+/g, '(')
    .trim();
  return s || title.trim();
}

/** Lowercase the first letter so a humanized title reads inside a sentence,
 *  unless it starts with an acronym / proper token we should not touch. */
function midSentence(s: string): string {
  if (!s) return s;
  // Leave ALL-CAPS leading words (e.g. "READ-STATE", "FULL-WIDTH") alone.
  const first = s.split(/\s/)[0] ?? '';
  if (first.length > 1 && first === first.toUpperCase()) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function topSenders(names: string[], max = 2): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  if (ranked.length === 0) return '';
  if (ranked.length <= max) return ranked.join(' and ');
  return `${ranked.slice(0, max).join(', ')} and others`;
}

/** A task "needs the owner" when its title explicitly calls for a decision,
 *  authorization, or confirmation from them. Intent words only — we never guess
 *  a blocker into existence. Mirrors ownerBrief.needsOwner, kept local so this
 *  module owns its honesty rules. */
function taskNeedsOwner(t: BriefTask): boolean {
  if (t.state === 'done' || t.state === 'rejected') return false;
  const s = t.title.toLowerCase();
  return /needs?\s+(waqas|you|owner|authoriz)|awaiting\s+(you|owner|authoriz)|owner\s+(pick|picks|decision|ruling)|\bdecision\b|\bauthoriz|\bconfirm with (waqas|you|owner)|host-ordered|host-critical/.test(s);
}

/** Pull a recommended option from source text when it literally states one
 *  ("recommend X", "suggest X", "recommended: X"). Returns null otherwise — we
 *  never manufacture a recommendation. */
function extractRecommendation(text: string | undefined): string | null {
  if (!text) return null;
  const m = text.match(/\b(?:recommend(?:ed)?|suggest(?:ed)?)\b[:\s]+([^.!?\n]{4,120})/i);
  if (!m || !m[1]) return null;
  return m[1].trim().replace(/\s+/g, ' ');
}

function mentionsOwner(text: string, selfName: string): boolean {
  const t = text.toLowerCase();
  if (t.includes(`@${selfName.toLowerCase()}`)) return true;
  return OWNER_ALIASES.some((a) => t.includes(`@${a}`));
}

// Openers that mark a message as an acknowledgement / status, never a decision
// for the owner — so "@Waqas thanks, the screenshot changes the diagnosis" is
// not misreported as something waiting on them.
const ACK_OPENERS = /^(thanks?|thank you|got it|ok(ay)?|great|nice|good|agreed|done|noted|fyi|update|status|confirmed|will do|on it|yes|no\b)/i;

/** Pull the QUESTION the owner is actually being asked: the first sentence that
 *  ends in a question mark. Returns null when there is none — we never promote a
 *  greeting or status line into a "decision waiting on you". */
function extractOwnerQuestion(text: string, selfName: string, max = 160): string | null {
  if (!mentionsOwner(text, selfName)) return null;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned.includes('?')) return null;
  // Split into sentences and take the first that is a genuine question.
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const q = s.trim();
    if (!q.endsWith('?')) continue;
    if (ACK_OPENERS.test(q)) continue;
    // Drop a leading @mention so the ask reads cleanly.
    const ask = q.replace(/^@\S+\s*/, '').trim();
    if (ask.length < 6) continue;
    return ask.length > max ? `${ask.slice(0, max - 1).trimEnd()}…` : ask;
  }
  return null;
}

function matchesTopic(text: string, topic: string): boolean {
  return text.toLowerCase().includes(topic.toLowerCase());
}

/** Strip everything that reads badly aloud: markdown, the brief glyph, SHAs,
 *  URLs, file paths, and standalone task ids. Same facts, listenable form. */
export function stripForSpeech(s: string): string {
  return s
    .replace(/📋|🔊/g, '')
    .replace(/\*\*/g, '')
    .replace(/[*_`#>]/g, '')
    .replace(/https?:\/\/\S+/g, 'the link')
    .replace(/\b[0-9a-f]{7,40}\b/gi, '')
    .replace(/\bT-\d+[a-z]?\b/g, '')
    .replace(/\/?\S+\.(mjs|tsx?|jsx?|json|png|jpg|css)\b/gi, '')
    // An ellipsis in a title (e.g. the "..." overflow-menu glyph) reads as
    // "dot dot dot" aloud — collapse runs of dots to a single comma pause.
    .replace(/\s*\.{2,}\s*/g, ', ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Compose the owner brief from real room state. Pure and deterministic: given the
 * same board + messages + marker it always yields the same brief, and it can only
 * surface facts those inputs contain.
 */
export function composeBrief(input: BriefProtocolInput): ComposedBrief {
  const deep = input.mode === 'deep';
  const topic = input.topic?.trim() || null;
  const self = input.selfName;

  const keepByTopic = <T extends { title?: string; text?: string }>(items: T[], get: (x: T) => string): T[] =>
    topic ? items.filter((x) => matchesTopic(get(x), topic)) : items;

  const tasks = keepByTopic(input.tasks, (t) => t.title);

  // --- Owner's flagged priority (lead with it when they stated one). ---
  const ownerMsgs = input.messages.filter((m) => m.name === self && m.text);
  let priority: string | null = null;
  for (let i = ownerMsgs.length - 1; i >= 0; i--) {
    const text = ownerMsgs[i]?.text ?? '';
    const m = text.match(/\b(?:my |the )?(?:top )?priority (?:is|:)\s*([^.!?\n]{4,120})/i)
      || text.match(/\bmost important(?:\s+thing)?\s*(?:is|:)\s*([^.!?\n]{4,120})/i);
    if (m && m[1]) { priority = m[1].trim().replace(/\s+/g, ' '); break; }
  }

  // --- 1. Decisions waiting on you. ---
  const decisions: BriefDecision[] = [];
  const seenAsks = new Set<string>();
  for (const t of tasks.filter(taskNeedsOwner)) {
    const ask = midSentence(humanizeTitle(t.title));
    const key = ask.toLowerCase().slice(0, 40);
    if (seenAsks.has(key)) continue;
    seenAsks.add(key);
    decisions.push({ ask, recommendation: extractRecommendation(t.title), source: `task:${t.id}` });
  }
  // Fresh (post-marker) messages that put an EXPLICIT question to the owner.
  // Board tasks are the trustworthy signal; message questions are surfaced only
  // when they genuinely end in "?" and are not an ack/status line, so we never
  // promote a greeting into a decision. Capped tighter than task decisions.
  const seen = Math.max(0, Math.min(input.firstUnreadIndex ?? 0, input.messages.length));
  const freshMsgs = input.firstUnreadIndex == null ? input.messages : input.messages.slice(seen);
  const scopedFresh = keepByTopic(freshMsgs, (m) => m.text ?? '');
  let msgDecisions = 0;
  for (const m of scopedFresh) {
    if (m.name === self) continue;
    if (msgDecisions >= (deep ? 4 : 2)) break;
    const ask = extractOwnerQuestion(m.text ?? '', self);
    if (!ask) continue;
    const key = ask.toLowerCase().slice(0, 40);
    if (seenAsks.has(key)) continue;
    seenAsks.add(key);
    decisions.push({ ask, recommendation: extractRecommendation(m.text), source: 'message' });
    msgDecisions++;
  }
  const decisionCap = deep ? 8 : 3;
  const shownDecisions = decisions.slice(0, decisionCap);

  // --- 2. Since you last checked in (the delta). ---
  const firstVisit = input.firstUnreadIndex == null;
  const fromOthersFresh = scopedFresh.filter((m) => m.name !== self);
  const building = tasks.filter((t) => t.state === 'in_progress');
  const buildingMeanings = building.map((t) => midSentence(humanizeTitle(t.title)));
  let delta: string;
  if (firstVisit) {
    const total = input.messages.filter((m) => m.name !== self).length;
    delta = `First time here. ${plural(total, 'message')} in this room so far.`;
  } else if (fromOthersFresh.length > 0) {
    const who = topSenders(fromOthersFresh.map((m) => m.name));
    delta = `${plural(fromOthersFresh.length, 'new message')} since you last looked${who ? `, from ${who}` : ''}.`;
  } else {
    delta = 'Nothing new since you last looked.';
  }
  if (buildingMeanings.length > 0) {
    const shown = buildingMeanings.slice(0, deep ? 6 : 2);
    const more = buildingMeanings.length - shown.length;
    delta += ` The room is working on ${shown.join(', and ')}${more > 0 ? `, plus ${more} more` : ''}.`;
  }

  // --- 3. Live now (done = shipped AND verifier-ruled). ---
  const done = tasks.filter((t) => t.state === 'done');
  // Board order puts newer tasks later; surface the most recent first.
  const liveMeanings = [...done].reverse().map((t) => humanizeTitle(t.title));
  const live = liveMeanings.slice(0, deep ? 10 : 3);

  // --- 4. Watch (stuck or claimed-not-checked). ---
  const rejected = tasks.filter((t) => t.state === 'rejected');
  const inReview = tasks.filter((t) => t.state === 'awaiting_review');
  const watch: string[] = [];
  for (const t of [...rejected].reverse().slice(0, deep ? 6 : 2)) {
    watch.push(`${humanizeTitle(t.title)} was sent back and needs rework${t.owner ? ` (${t.owner})` : ''}.`);
  }
  if (inReview.length > 0) {
    watch.push(`${plural(inReview.length, 'change')} claimed and awaiting independent verification.`);
  }

  // --- 5. Next milestone. ---
  const rank = (t: BriefTask): number => {
    const s = t.title.toLowerCase();
    let score = 0;
    if (/\bp0\b|hotfix|host-critical|host-ordered|urgent|emergency/.test(s)) score += 100;
    if (t.state === 'in_progress') score += 10;
    return score;
  };
  const openForNext = tasks.filter((t) => t.state === 'in_progress' || t.state === 'todo');
  const nextTask = [...openForNext].sort((a, b) => rank(b) - rank(a))[0] ?? null;
  const next = nextTask
    ? `${humanizeTitle(nextTask.title)}${nextTask.state === 'in_progress' ? ' — in progress' : ' — up next'}, then it ships on your word.`
    : null;

  const sections = {
    priority,
    decisions: shownDecisions,
    delta,
    live,
    watch,
    next,
  };

  return { display: renderDisplay(sections, decisions.length), speech: renderSpeech(sections, decisions.length), sections };
}

function renderDisplay(s: ComposedBrief['sections'], totalDecisions: number): string {
  const out: string[] = ['📋 **EXECUTIVE BRIEF**'];
  if (s.priority) out.push(`_Your priority: ${s.priority}_`);

  out.push('');
  out.push('**Decisions waiting on you**');
  if (s.decisions.length === 0) {
    out.push('Nothing needs you right now.');
  } else {
    s.decisions.forEach((d, i) => {
      const rec = d.recommendation ? ` — _recommended:_ ${d.recommendation}` : '';
      out.push(`${i + 1}. ${d.ask}${rec}`);
    });
    if (totalDecisions > s.decisions.length) {
      out.push(`…and ${totalDecisions - s.decisions.length} more — say “/brief deep” for the full list.`);
    }
  }

  out.push('');
  out.push('**Since you last checked in**');
  out.push(s.delta);

  if (s.live.length > 0) {
    out.push('');
    out.push('**Live now**');
    out.push(s.live.map((l) => `• ${l}`).join('\n'));
  }

  if (s.watch.length > 0) {
    out.push('');
    out.push('**Watch**');
    out.push(s.watch.map((w) => `• ${w}`).join('\n'));
  }

  if (s.next) {
    out.push('');
    out.push('**Next**');
    out.push(s.next);
  }

  return out.join('\n');
}

function renderSpeech(s: ComposedBrief['sections'], totalDecisions: number): string {
  const parts: string[] = [];
  if (s.priority) parts.push(`Your priority is ${s.priority}.`);

  if (s.decisions.length === 0) {
    parts.push('Nothing needs your decision right now.');
  } else if (s.decisions.length === 1 && s.decisions[0]) {
    const d = s.decisions[0];
    parts.push(`One decision is waiting on you. ${endSentence(d.ask)}${d.recommendation ? ` The recommendation is ${endSentence(d.recommendation)}` : ''}`);
  } else {
    parts.push(`${cap(numberWord(s.decisions.length))} decisions are waiting on you.`);
    const ord = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
    s.decisions.forEach((d, i) => {
      const lead = ord[i] ?? `Number ${i + 1}`;
      parts.push(`${lead}, ${endSentence(lower(d.ask))}${d.recommendation ? ` The recommendation is ${endSentence(d.recommendation)}` : ''}`);
    });
    const extra = totalDecisions - s.decisions.length;
    if (extra > 0) parts.push(extra === 1 ? 'There is one more.' : `There are ${numberWord(extra)} more.`);
  }

  parts.push(endSentence(s.delta));
  if (s.live.length > 0) parts.push(`Live now: ${endSentence(joinSentence(s.live.map(stripTrailingDot)))}`);
  if (s.watch.length > 0) parts.push(`Worth watching: ${endSentence(joinSentence(s.watch.map(stripTrailingDot)))}`);
  if (s.next) parts.push(`Next up, ${endSentence(lower(s.next))}`);

  return stripForSpeech(parts.join(' '));
}

function stripTrailingDot(s: string): string { return s.replace(/\.\s*$/, ''); }
/** Exactly one terminal period — strips any trailing punctuation first so we
 *  never produce "stalled.." or a mid-sentence run-on in the spoken brief. */
function endSentence(s: string): string {
  const trimmed = s.replace(/[\s.!?;:,]+$/, '').trim();
  return trimmed ? `${trimmed}.` : '';
}
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
function lower(s: string): string { return s.charAt(0).toLowerCase() + s.slice(1); }
function joinSentence(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join('; ')}; and ${items[items.length - 1]}`;
}
function numberWord(n: number): string {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  return words[n] ?? String(n);
}
