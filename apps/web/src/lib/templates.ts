// Room templates seed a new meeting with a topic shape, suggested roles, and
// an opening message that demonstrates the [DECISION] / [TODO] / [STATUS] /
// [RESULT] markers so participants drop into a structured conversation
// instead of starting from a blank room.
//
// The opening message is sent as a normal `msg` from the creator on first
// load of the room — see Lobby for the wiring. Templates do NOT change the
// underlying Room schema; they're pure UI seed data.

import type { RolePreset } from '@agent-room/shared';
import { ROLE_PRESETS } from '@agent-room/shared';

export interface RoomTemplate {
  id: string;
  label: string;
  emoji: string;
  description: string;
  /** One-line "pick me when…" shown on the creation picker card — the moment
   *  of choosing a room type is the moment the host learns what types exist. */
  whenToUse: string;
  // Placeholder topic the host can edit. `{X}` markers signal "edit me here"
  // — we don't auto-replace, just hint visually.
  topicSeed: string;
  // RolePreset ids that this template recommends. Surfaced as chips so the
  // host can copy invite links pre-stamped with the role they want a teammate
  // / agent to play.
  suggestedRoleIds: string[];
  // First message in the room — frames the conversation and demos the tag
  // syntax so future participants follow the convention.
  openingMessage: string;
}

const r = (id: string): RolePreset | undefined => ROLE_PRESETS.find(p => p.id === id);

export const ROOM_TEMPLATES: RoomTemplate[] = [
  {
    id: 'blank',
    label: 'Blank room',
    emoji: '◇',
    description: 'Start with just a topic — no opening message, no role suggestions.',
    whenToUse: 'You just need a space and a topic — no structure wanted.',
    topicSeed: '',
    suggestedRoleIds: [],
    openingMessage: '',
  },
  {
    id: 'code-review',
    label: 'Code Review',
    emoji: '🔍',
    description: 'Walk a PR / patch through Builder, QA, and Skeptic agents and capture the verdict.',
    whenToUse: 'A PR, diff, or commit needs eyes and a merge/block verdict.',
    topicSeed: 'Code review: {pr-title-or-link}',
    suggestedRoleIds: ['builder', 'qa-reviewer', 'skeptic'],
    openingMessage:
      "Welcome — this is a code-review room. Use these markers as we go so the delivery report writes itself:\n\n" +
      "- `[DECISION]` for merge / block / refactor calls\n" +
      "- `[TODO]` for follow-up work the author needs to do\n" +
      "- `[STATUS]` for the current review state\n" +
      "- `[RESULT]` for the final outcome\n\n" +
      "Paste the diff or PR link to start.",
  },
  {
    id: 'feature-build',
    label: 'Feature Build',
    emoji: '🛠️',
    description: 'Greenfield development room — design, implement, and verify a new feature with Builder + QA + Facilitator.',
    whenToUse: "You're building something new and want story → tasks → tests discipline.",
    topicSeed: 'Build: {feature-name}',
    suggestedRoleIds: ['facilitator', 'builder', 'qa-reviewer'],
    openingMessage:
      "Feature build room. Walk the work through: user story → design → tasks → implementation → tests. Mark output with:\n\n" +
      "- `[DECISION]` for scope / API shape / library choices\n" +
      "- `[TODO]` for each implementation task with an owner\n" +
      "- `[STATUS]` for progress (\"WIP\", \"PR up\", \"deployed to staging\")\n" +
      "- `[RESULT]` for shipped artifacts (PR link, deployed URL, test results)\n\n" +
      "Kickoff: what's the user story, what's the smallest shippable slice, who owns it?",
  },
  {
    id: 'bug-fix',
    label: 'Bug Fix',
    emoji: '🐛',
    description: 'Reproduce → root-cause → fix → verify. Builder + QA + Skeptic make sure the fix actually holds.',
    whenToUse: "Something's broken; you need repro → root cause → verified fix.",
    topicSeed: 'Bug: {short-description}',
    suggestedRoleIds: ['builder', 'qa-reviewer', 'skeptic'],
    openingMessage:
      "Bug-fix room. Step through: reproduce → narrow down → root cause → fix → verify. Mark each phase:\n\n" +
      "- `[STATUS]` reproducible / not-reproducible / intermittent + repro steps\n" +
      "- `[DECISION]` chosen fix approach (and what we explicitly rejected)\n" +
      "- `[TODO]` the fix work, the regression test to add, the cleanup\n" +
      "- `[RESULT]` verified resolution + commit/PR link, plus blast-radius note\n\n" +
      "Open with: minimal repro, observed vs expected behavior, environment, when it started.",
  },
  {
    id: 'incident',
    label: 'Incident Response',
    emoji: '🚨',
    description: 'Triage a production issue with structured timeline, decisions, and follow-ups.',
    whenToUse: 'Production is on fire right now and needs coordinated triage.',
    topicSeed: 'Incident: {short-summary}',
    suggestedRoleIds: ['facilitator', 'builder', 'qa-reviewer'],
    openingMessage:
      "Incident room open. Keep updates short and use:\n\n" +
      "- `[STATUS]` whenever the situation changes (mitigated, rolled back, monitoring, etc.)\n" +
      "- `[DECISION]` for go/no-go calls (rollback, hotfix, declare resolved)\n" +
      "- `[TODO]` for postmortem follow-ups\n" +
      "- `[RESULT]` for the final resolution + customer impact\n\n" +
      "First message: what's broken, when it started, and current blast radius.",
  },
  {
    id: 'strategy',
    label: 'Strategy / Brainstorm',
    emoji: '🧭',
    description: 'Explore options with Researcher + Skeptic, converge on a direction with explicit decisions.',
    whenToUse: 'Direction is unclear — explore options, then commit to one.',
    topicSeed: '{topic} — direction & next steps',
    suggestedRoleIds: ['facilitator', 'researcher', 'skeptic'],
    openingMessage:
      "Strategy room — diverge first, then converge. Mark output as you go:\n\n" +
      "- `[DECISION]` once the group commits to a path\n" +
      "- `[TODO]` for the work each path requires\n" +
      "- `[STATUS]` for assumption checks (\"validated\", \"open question\", \"blocked on X\")\n" +
      "- `[RESULT]` for the chosen direction + rationale\n\n" +
      "Open question: what are we optimizing for and what would change our mind?",
  },
  {
    id: 'live-ops',
    label: 'Live Ops / Project HQ',
    emoji: '🔁',
    description: 'Standing home base for a project — report issues, assign work, ship fixes, verify, repeat.',
    whenToUse: "The project's always-on room: you drop asks day after day and agents ship them.",
    topicSeed: '{project} HQ',
    suggestedRoleIds: ['facilitator', 'builder', 'qa-reviewer'],
    openingMessage:
      "Project HQ open — this room runs continuously. The loop: report → assign → fix → verify.\n\n" +
      "- One agent is the arbiter: every task gets an explicit owner before work starts\n" +
      "- `[STATUS]` when you take something on and at meaningful checkpoints\n" +
      "- `[DECISION]` for anything with a trade-off (and what was rejected)\n" +
      "- `[RESULT]` for every finish — with the commit hash and how it was verified\n" +
      "- Sizeable work goes on the task board with evidence before it's called done\n\n" +
      "What's broken or wanted first?",
  },
  {
    id: 'support-desk',
    label: 'Support Desk',
    emoji: '📞',
    description: 'Ongoing customer-service triage — acknowledge, route or resolve, and log every outcome.',
    whenToUse: 'A steady stream of support issues needs triage, answers, and escalation.',
    topicSeed: '{product} support desk',
    suggestedRoleIds: ['facilitator', 'builder', 'writer'],
    openingMessage:
      "Support desk open — this room triages incoming issues continuously.\n\n" +
      "- `[STATUS]` to acknowledge each incoming issue (so nothing sits unseen)\n" +
      "- `[DECISION]` for routing calls: answer here, fix now, or escalate\n" +
      "- `[TODO]` for escalations — real defects graduate to a bug-fix room\n" +
      "- `[RESULT]` to close each issue with the resolution given\n\n" +
      "Paste or forward the first issue to start the queue.",
  },
  {
    id: 'delivery',
    label: 'Delivery Planning',
    emoji: '📦',
    description: 'Plan a deliverable with Builder + Writer and produce a client-ready report.',
    whenToUse: 'You owe someone a deliverable with a deadline and owners.',
    topicSeed: '{deliverable} — plan & ownership',
    suggestedRoleIds: ['facilitator', 'builder', 'writer'],
    openingMessage:
      "Delivery planning room. The end state is a client-ready report — every action you take should land in:\n\n" +
      "- `[DECISION]` scope, deadline, owner calls\n" +
      "- `[TODO]` work items with an owner attached\n" +
      "- `[STATUS]` daily progress updates\n" +
      "- `[RESULT]` shipped artifacts (links, docs, PRs)\n\n" +
      "Kickoff: what does \"done\" look like for the client, and who owns each piece?",
  },
];

// Suggest a room type from what the host is typing as the topic — the tag
// chip this feeds is suggestion-only (host taps to accept), never auto-applied.
const TOPIC_HINTS: Array<[RegExp, string]> = [
  [/\b(bug|broken|crash|regression|not working|fix)\b/i, 'bug-fix'],
  [/\b(incident|outage|down|sev ?\d|p0|on fire)\b/i, 'incident'],
  [/\b(review|pull request|diff|patch)\b|\bpr\b/i, 'code-review'],
  [/\b(support|customer|helpdesk|ticket|triage)\b/i, 'support-desk'],
  [/\b(hq|ops|admin|master|home base)\b/i, 'live-ops'],
  [/\b(build|feature|implement|greenfield)\b/i, 'feature-build'],
  [/\b(strategy|brainstorm|direction|options)\b/i, 'strategy'],
  [/\b(deliverable|deadline|client|delivery)\b/i, 'delivery'],
];
export function suggestTemplateForTopic(topic: string): RoomTemplate | undefined {
  const t = String(topic || '').trim();
  if (t.length < 3) return undefined;
  for (const [re, id] of TOPIC_HINTS) if (re.test(t)) return templateById(id);
  return undefined;
}

export function templateById(id: string | null | undefined): RoomTemplate | undefined {
  if (!id) return undefined;
  return ROOM_TEMPLATES.find(t => t.id === id);
}

export function roleLabelFor(roleId: string): string {
  return r(roleId)?.label ?? roleId;
}

export function roleNameFor(roleId: string): string {
  return r(roleId)?.role ?? roleId;
}
