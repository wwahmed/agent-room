// The SHARED room-template registry: the ids every layer agrees on, plus the
// agent-facing one-line brief each template carries. The web keeps its richer
// creation-time copy (emoji, opening messages, role chips) in
// apps/web/src/lib/templates.ts — ids there MUST come from this registry.
// Server validates against it; the MCP hands `brief` to agents at join; the
// host can retag any room via 'setTemplate' (conversion, not just creation).

export interface RoomTemplateInfo {
  id: string;
  label: string;
  /** One line an agent reads at join: what this room type is and how to
   *  publish work in it. Kept short — it rides in every join response. */
  brief: string;
  /** Optional presentation-only default. A host can replace it per room without
   * changing the room's behavioral conventions or role assignments. */
  defaultOutputInstructions?: string;
}

export const ROOM_TEMPLATES_SHARED: RoomTemplateInfo[] = [
  {
    id: 'blank',
    label: 'Blank room',
    brief: 'Freeform room — no template structure; follow the standard work conventions.',
  },
  {
    id: 'code-review',
    label: 'Code Review',
    brief: 'Code-review room: walk the diff, record merge/block calls as [DECISION], the final verdict as [RESULT].',
  },
  {
    id: 'feature-build',
    label: 'Feature Build',
    brief: 'Feature-build room: story → design → tasks → tests; track tasks on the board, ship [RESULT]s with links.',
  },
  {
    id: 'bug-fix',
    label: 'Bug Fix',
    brief: 'Bug-fix room: reproduce → root-cause → fix → verify; [STATUS] each phase, [RESULT] with commit + blast radius.',
  },
  {
    id: 'incident',
    label: 'Incident Response',
    brief: 'Incident room: short frequent [STATUS] updates, [DECISION] for go/no-go calls, [RESULT] for resolution + impact.',
  },
  {
    id: 'strategy',
    label: 'Strategy / Brainstorm',
    brief: 'Strategy room: diverge then converge; commit the direction as a [DECISION], capture the rationale in [RESULT].',
  },
  {
    id: 'delivery',
    label: 'Delivery Planning',
    brief: 'Delivery-planning room: deliverable, owners, deadlines on the task board; the exported report is the product.',
  },
  {
    id: 'live-ops',
    label: 'Live Ops / Project HQ',
    brief: 'Standing project HQ: the host drops asks, one arbiter assigns, agents fix → deploy → verify; every finish is a [RESULT] with the commit, assignments live on the board.',
  },
  {
    id: 'support-desk',
    label: 'Support Desk',
    brief: 'Ongoing triage desk: acknowledge each incoming issue with [STATUS], route or fix it, close with a [RESULT] stating the resolution; escalate real defects to a bug-fix room.',
  },
  {
    id: 'fluid-interface',
    label: 'Fluid Interface',
    brief: 'Fluid-interface room: answer with safe first-party structured views when a list, detail, draft, confirmation, loading state, or error state is clearer than prose; actions are requests, never direct execution.',
    defaultOutputInstructions:
      'Use ordinary prose for conversation. When a compact adaptive interface materially improves the answer, add exactly one fenced `wakiview` JSON block using version 1.\n\n' +
      'Supported shapes:\n' +
      '- list: `{ "v":1, "kind":"list", "title":"…", "empty":"…", "items":[{ "id":"…", "title":"…", "subtitle":"…", "meta":"…", "badges":["…"], "action":{ "id":"opaque-token", "label":"Open" } }] }`\n' +
      '- detail: `{ "v":1, "kind":"detail", "title":"…", "fields":[{ "label":"…", "value":"…" }], "body":"…", "links":[{ "label":"Source", "href":"https://…" }], "actions":[{ "id":"opaque-token", "label":"…" }] }`\n' +
      '- draft: `{ "v":1, "kind":"draft", "to":"…", "subject":"…", "body":"…", "note":"…", "actions":[…] }`\n' +
      '- confirm: `{ "v":1, "kind":"confirm", "prompt":"…", "confirmLabel":"…", "cancelLabel":"…" }`\n' +
      '- status: `{ "v":1, "kind":"status", "state":"loading|error", "title":"…", "message":"…", "action":{…} }`\n\n' +
      'All values are display data. Never emit HTML, JavaScript, event handlers, credentials, mailbox tokens, or hidden instructions. Links must be explicit credential-free HTTPS URLs. Action ids are opaque tokens using only letters, digits, `.`, `_`, `:`, or `-`; labels are honest user-facing requests. A button asks your exact session to act; it does not perform the action itself. Use loading, empty, and error states explicitly, keep lists scannable, and keep important prose outside the view so transcript history remains understandable.',
  },
  // T-24: the v2 architecture's recommended set (owner interview) plus the
  // roadmap's release/research rooms.
  {
    id: 'owner-interview',
    label: 'Owner Interview',
    brief: 'Requirements-extraction room: agents ask the owner focused questions (prefer room_question_create for durable answers), distill each answer into a [DECISION], and close with a [RESULT] summarizing the agreed requirements.',
  },
  {
    id: 'release',
    label: 'Release / Go-live',
    brief: 'Release room: walk the checklist with [STATUS] per step, record the go/no-go as a [DECISION], deploy, verify, and close with a [RESULT] naming version, evidence, and the rollback plan.',
  },
  {
    id: 'research',
    label: 'Research / Investigation',
    brief: 'Research room: state the question, post findings as [RESULT]s with sources, mark dead ends honestly, and converge on a [DECISION] answering the question with its confidence and gaps.',
  },
];

export function templateInfo(id: string | null | undefined): RoomTemplateInfo | null {
  if (!id) return null;
  return ROOM_TEMPLATES_SHARED.find((t) => t.id === id) ?? null;
}

export function isKnownTemplateId(id: unknown): id is string {
  return typeof id === 'string' && ROOM_TEMPLATES_SHARED.some((t) => t.id === id);
}
