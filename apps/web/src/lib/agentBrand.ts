// T-44/T-47: provider branding for agent avatars. The mark is chosen from the
// participant's harness METADATA (stamped by its MCP from detected env),
// never from the display name — name parsing is exactly how a human called
// "Claude Smith" would get mis-branded. Humans are never brand-marked.

export type BrandMark = 'claude' | 'codex' | 'generic';

export interface AgentBrand {
  mark: BrandMark;
  label: string;
}

export function brandFor(p: { client: string; harness?: string }): AgentBrand | null {
  if (p.client !== 'cc') return null;
  const harness = (p.harness ?? '').toLowerCase();
  if (harness.startsWith('claude')) return { mark: 'claude', label: 'Claude Code' };
  if (harness === 'codex') return { mark: 'codex', label: 'Codex' };
  // Agent with no or unrecognized harness metadata: generic agent mark, so
  // humans and agents stay distinguishable even without provider info.
  return { mark: 'generic', label: 'Agent' };
}

/** The kind string shown beside a participant. UX rule: never ASSERT
 *  humanity — a web row may be a person or an agent driving a browser, so
 *  the unbranded label is the neutral "web session", not "human". */
export function participantKindLabel(p: { client: string; harness?: string }): string {
  return brandFor(p)?.label ?? 'web session';
}
