// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { AgentContextMenu } from './AgentContextMenu.js';
import type { SummonedAgent } from '../lib/api.js';
import type { ParticipantHealth, PresenceState } from '../lib/presence.js';

// The host's ask: right-click an agent that went quiet and have the APP bring
// it back, instead of opening a terminal and pasting a prompt by hand.

const summoned = (over: Partial<SummonedAgent> = {}): SummonedAgent => ({
  agentId: 'grin-rib-tank-copilotwatcher-87a7f998', name: 'CoPilotWatcher', role: 'AI Agent',
  provider: 'copilot', model: 'gpt-5.5', workspace: '/Users/wahmed/workspaces/agent-room',
  room: 'grin-rib-tank', mode: 'build', status: 'active', health: 'offline',
  tmuxSession: 'sm-grin', access: [], createdAt: 1, accessLevel: 'build',
  ...over,
});

const health = (state: PresenceState): ParticipantHealth => ({
  name: 'CoPilotWatcher', client: 'cc', role: 'AI Agent', state,
  lastSeenAgoMs: 613_275, listenRemainingMs: 0,
});

const menu = { name: 'CoPilotWatcher', role: 'AI Agent', client: 'cc', x: 40, y: 40 };

function renderMenu(over: Partial<Parameters<typeof AgentContextMenu>[0]> = {}) {
  const props = {
    menu, code: 'grin-rib-tank', health: health('disconnected'), agent: summoned(),
    onClose: () => {}, onOpenDetails: () => {}, onChanged: () => {},
    ...over,
  } as Parameters<typeof AgentContextMenu>[0];
  return render(<AgentContextMenu {...props} />);
}

const gate = (name: string) => document.querySelector(`[data-gate="${name}"]`);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AgentContextMenu', () => {
  it('brings a stopped agent back through the app, at the level it already had', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ agent: summoned() }) } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn();
    renderMenu({ onChanged });

    const button = gate('agent-menu-bring-back')!;
    expect(button).not.toBeNull();
    fireEvent.click(button);

    await waitFor(() => { if (!fetchMock.mock.calls.length) throw new Error('no request yet'); });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/api/summon/relaunch');
    // The current level, NOT a default: reviving must never re-permission an agent.
    expect(JSON.parse(String(init.body))).toEqual({
      agentId: 'grin-rib-tank-copilotwatcher-87a7f998', mode: 'build',
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('surfaces the summoner\'s own refusal rather than a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 409,
      json: async () => ({ error: 'Conflict', message: 'This agent was adopted, not summoned.' }),
    } as Response)));
    renderMenu();

    fireEvent.click(gate('agent-menu-bring-back')!);
    await waitFor(() => {
      const err = gate('agent-menu-error');
      if (!err) throw new Error('no error yet');
      expect(err.textContent).toContain('adopted, not summoned');
    });
  });

  it('offers no bring-back for an adopted agent, and says why instead', () => {
    renderMenu({ agent: summoned({ adopted: true }) });
    // A button that always 409s is worse than no button.
    expect(gate('agent-menu-bring-back')).toBeNull();
    expect(gate('agent-menu-blocked')!.textContent).toContain('already running when the app attached');
  });

  it('explains a join-code agent in terms of whose process it is', () => {
    renderMenu({ agent: null });
    expect(gate('agent-menu-bring-back')).toBeNull();
    expect(gate('agent-menu-blocked')!.textContent).toContain('invite code');
  });

  it('leads a quiet agent with waiting so a busy one is not interrupted', () => {
    renderMenu({ health: health('stale') });
    expect(gate('agent-menu-wait')!.textContent).toContain('long task');
    // Still offered, just no longer the first thing suggested.
    expect(gate('agent-menu-bring-back')).not.toBeNull();
  });

  it('shows no recovery at all for a healthy agent', () => {
    renderMenu({ health: health('listening') });
    expect(gate('agent-menu-wait')).toBeNull();
    expect(gate('agent-menu-bring-back')).toBeNull();
    expect(gate('agent-menu-manual')).toBeNull();
    // Details stays available: the menu is still useful when nothing is wrong.
    expect(document.body.textContent).toContain('Agent details');
  });

  it('keeps the terminal path available but demoted when the app can do the job', () => {
    renderMenu();
    expect(gate('agent-menu-manual')).not.toBeNull();
    expect(gate('agent-menu-blocked')).toBeNull();
  });

  it('offers removal only to the host', () => {
    const onRemove = vi.fn();
    renderMenu({ isHost: false, onRemove });
    expect(gate('agent-menu-remove')).toBeNull();
    cleanup();
    renderMenu({ isHost: true, onRemove });
    fireEvent.click(gate('agent-menu-remove')!);
    expect(onRemove).toHaveBeenCalled();
  });

  it('speaks plainly in the status line', () => {
    renderMenu();
    expect(document.body.textContent).toContain('Stopped');
    expect(document.body.textContent).not.toMatch(/listen loop|heartbeat|tmux|disconnected/i);
  });
});
