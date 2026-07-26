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
];

export function templateInfo(id: string | null | undefined): RoomTemplateInfo | null {
  if (!id) return null;
  return ROOM_TEMPLATES_SHARED.find((t) => t.id === id) ?? null;
}

export function isKnownTemplateId(id: unknown): id is string {
  return typeof id === 'string' && ROOM_TEMPLATES_SHARED.some((t) => t.id === id);
}
