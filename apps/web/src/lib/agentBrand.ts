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

/** T-47: brand for a message SENDER. Harness metadata (from the live
 *  participant row) outranks everything; when the row is gone or predates
 *  the harness field, an EXACT normalized display name ('claude', 'codex',
 *  optionally with a '(N)' suffix) is the sanctioned fallback — never a
 *  substring, so "Claude Smith" stays unbranded generic. Humans (web) null. */
export function brandForSender(
  sender: { client: string; name: string },
  participants: Array<{ name: string; client: string; harness?: string }> = [],
): AgentBrand | null {
  if (sender.client !== 'cc') return null;
  const row = participants.find(p => p.name === sender.name && p.client === 'cc');
  if (row?.harness) return brandFor(row);
  const base = sender.name.trim().toLowerCase().replace(/\s*\(\d+\)$/, '');
  if (base === 'claude') return { mark: 'claude', label: 'Claude Code' };
  if (base === 'codex') return { mark: 'codex', label: 'Codex' };
  return { mark: 'generic', label: 'Agent' };
}
