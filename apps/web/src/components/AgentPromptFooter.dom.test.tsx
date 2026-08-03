// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { AgentPromptFooter, blockedAgents } from './AgentPromptFooter.js';
import type { SummonedAgent } from '../lib/api.js';

// "Permissions prompt from summoned agents go into agent details instead of
// prominently pinned as chat footer." The agent is STOPPED until answered, so
// the footer must appear for exactly the blocked ones and never linger.

const agent = (over: Partial<SummonedAgent> = {}): SummonedAgent => ({
  agentId: 'a1', name: 'Builder', role: '', provider: 'claude', model: 'opus',
  workspace: '/w', room: 'a-b-c', mode: 'edit', status: 'running',
  health: 'blocked-on-prompt', tmuxSession: 't', access: [], createdAt: 1,
  ...over,
} as SummonedAgent);

function render(ui: React.ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => { createRoot(host).render(ui); });
  return host;
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { vi.restoreAllMocks(); });

describe('blockedAgents selection', () => {
  it('picks only agents stopped on a prompt', () => {
    const rows = [agent({ agentId: 'a' }), agent({ agentId: 'b', health: 'healthy' }), agent({ agentId: 'c' })];
    expect(blockedAgents(rows).map(a => a.agentId)).toEqual(['a', 'c']);
  });

  it('ignores a dismissed agent — it is gone, not waiting', () => {
    expect(blockedAgents([agent({ dismissedAt: 123 })])).toEqual([]);
  });

  it.each([
    ['null', null],
    ['empty', []],
  ])('handles %s agent lists', (_l, rows) => {
    expect(blockedAgents(rows as SummonedAgent[] | null)).toEqual([]);
  });

  it('survives junk rows without throwing', () => {
    const rows = [null, undefined, agent()] as unknown as SummonedAgent[];
    expect(() => blockedAgents(rows)).not.toThrow();
    expect(blockedAgents(rows)).toHaveLength(1);
  });
});

describe('pinned permission footer', () => {
  it('renders nothing when no agent is blocked', () => {
    const host = render(<AgentPromptFooter agents={[agent({ health: 'healthy' })]} />);
    expect(host.querySelector('[data-gate="agent-prompt-footer"]')).toBeNull();
  });

  it('names the agent and offers all three answers', () => {
    const host = render(<AgentPromptFooter agents={[agent({ name: 'Codex' })]} />);
    const footer = host.querySelector('[data-gate="agent-prompt-footer"]')!;
    expect(footer).not.toBeNull();
    expect(footer.textContent).toContain('Codex needs your permission');
    const labels = [...footer.querySelectorAll('button')].map(b => b.textContent);
    expect(labels).toEqual(['Approve', 'Always allow', 'Deny']);
  });

  it('announces itself assertively — the agent is stopped until answered', () => {
    const host = render(<AgentPromptFooter agents={[agent()]} />);
    const footer = host.querySelector('[data-gate="agent-prompt-footer"]')!;
    expect(footer.getAttribute('role')).toBe('alert');
    expect(footer.getAttribute('aria-live')).toBe('assertive');
  });

  it('shows what is being asked, so the answer is informed', () => {
    const host = render(<AgentPromptFooter agents={[agent({ promptPreview: 'Allow rm -rf /tmp/build?' })]} />);
    expect(host.querySelector('[data-gate="agent-prompt-footer"]')!.textContent).toContain('Allow rm -rf /tmp/build?');
  });

  it('says how many others are waiting without stacking cards over the chat', () => {
    const host = render(<AgentPromptFooter agents={[agent({ agentId: 'a' }), agent({ agentId: 'b' }), agent({ agentId: 'c' })]} />);
    const footer = host.querySelector('[data-gate="agent-prompt-footer"]')!;
    expect(footer.textContent).toContain('2 other agents also waiting');
    expect(host.querySelectorAll('[data-gate="agent-prompt-footer"]')).toHaveLength(1);
  });

  it('uses singular wording for exactly one other', () => {
    const host = render(<AgentPromptFooter agents={[agent({ agentId: 'a' }), agent({ agentId: 'b' })]} />);
    expect(host.querySelector('[data-gate="agent-prompt-footer"]')!.textContent).toContain('1 other agent also waiting');
  });

  it('keeps every answer at the 44px touch floor', () => {
    const host = render(<AgentPromptFooter agents={[agent()]} />);
    for (const b of host.querySelectorAll('[data-gate="agent-prompt-footer"] button')) {
      expect(b.className).toContain('min-h-11');
    }
  });
});
