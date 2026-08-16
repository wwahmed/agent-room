// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { AgentDetailsSheet } from './AgentDetailsSheet.js';
import type { SummonedAgent } from '../lib/api.js';
import { recoveryPrompt, type ParticipantHealth } from '../lib/presence.js';

// Change-permissions flow: the Permissions row on a live SUMMONED agent gains
// a Change control that discloses a chat/edit/build picker; choosing a new
// level demands an explicit relaunch confirmation before anything happens.
// Join-code agents stay read-only — their process isn't ours to relaunch.

const summoned = (over: Partial<SummonedAgent> = {}): SummonedAgent => ({
  agentId: 'room-claude-abc123', name: 'ClaudeBuilder', role: 'AI Agent',
  provider: 'claude-corporate', model: 'claude-fable-5', workspace: '/tmp/ws',
  room: 'abc-def-ghj', mode: 'edit', status: 'active', health: 'online',
  tmuxSession: 'sm-x', access: [], createdAt: 1, accessLevel: 'edit',
  accessLabel: 'Edit — can create/modify files in the workspace',
  ...over,
});

const participant = { name: 'ClaudeBuilder', role: 'AI Agent', client: 'cc' };

function mockAgentsResponse(agents: SummonedAgent[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/summon/agents')) {
      return { ok: true, status: 200, json: async () => ({ agents }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ agent: agents[0] }) } as Response;
  }));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AgentDetailsSheet — change permissions', () => {
  it('discloses the level picker on intent and requires confirmation to relaunch', async () => {
    mockAgentsResponse([summoned()]);
    render(<AgentDetailsSheet code="abc-def-ghj" participant={participant} onClose={() => {}} />);
    const change = await waitFor(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Change');
      if (!btn) throw new Error('no Change button yet');
      return btn;
    });
    expect(document.querySelector('[data-gate="permission-picker"]')).toBeNull(); // closed at rest

    fireEvent.click(change);
    const picker = document.querySelector('[data-gate="permission-picker"]')!;
    expect(picker).not.toBeNull();
    const options = [...picker.querySelectorAll('[role="radio"]')];
    expect(options.map(o => o.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']); // current=edit
    expect(picker.textContent).toContain('Edit (current)');
    expect(picker.textContent).not.toContain('Relaunch'); // no confirm until a NEW level is picked

    fireEvent.click(options[2] as HTMLButtonElement); // pick build
    expect(picker.textContent).toContain('Relaunch');
    expect(picker.textContent).toContain('build access');
  });

  it('re-picking the current level never offers a relaunch', async () => {
    mockAgentsResponse([summoned()]);
    render(<AgentDetailsSheet code="abc-def-ghj" participant={participant} onClose={() => {}} />);
    const change = await waitFor(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Change');
      if (!btn) throw new Error('not loaded');
      return btn;
    });
    fireEvent.click(change);
    const picker = document.querySelector('[data-gate="permission-picker"]')!;
    fireEvent.click(picker.querySelectorAll('[role="radio"]')[1] as HTMLButtonElement); // edit = current
    expect(picker.textContent).not.toContain('Relaunch');
  });

  it('offers no Change control for join-code agents or dismissed agents', async () => {
    mockAgentsResponse([]); // no summoner record → joined via code
    render(<AgentDetailsSheet code="abc-def-ghj" participant={participant} onClose={() => {}} />);
    await waitFor(() => {
      if (document.body.textContent?.includes('Loading')) throw new Error('still loading');
    });
    expect([...document.querySelectorAll('button')].find(b => b.textContent === 'Change')).toBeUndefined();

    cleanup();
    mockAgentsResponse([summoned({ status: 'dismissed', dismissedAt: 2 })]);
    render(<AgentDetailsSheet code="abc-def-ghj" participant={participant} onClose={() => {}} />);
    await waitFor(() => {
      if (document.body.textContent?.includes('Loading')) throw new Error('still loading');
    });
    expect([...document.querySelectorAll('button')].find(b => b.textContent === 'Change')).toBeUndefined();
  });

  it('confirming posts the relaunch and reports the swap', async () => {
    const relaunched = summoned({ mode: 'build', accessLevel: 'build', accessLabel: 'Build — edits files and runs commands autonomously' });
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/summon/agents')) {
        return { ok: true, status: 200, json: async () => ({ agents: [summoned()] }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ agent: relaunched }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentDetailsSheet code="abc-def-ghj" participant={participant} onClose={() => {}} />);
    const change = await waitFor(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Change');
      if (!btn) throw new Error('not loaded');
      return btn;
    });
    fireEvent.click(change);
    const picker = document.querySelector('[data-gate="permission-picker"]')!;
    fireEvent.click(picker.querySelectorAll('[role="radio"]')[2] as HTMLButtonElement);
    fireEvent.click([...picker.querySelectorAll('button')].find(b => b.textContent === 'Relaunch')!);

    await waitFor(() => {
      if (!document.body.textContent?.includes('relaunching with build access')) throw new Error('no note yet');
    });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit?][];
    const relaunchCall = calls.find(c => String(c[0]).includes('/api/summon/relaunch'))!;
    expect(relaunchCall).toBeTruthy();
    expect(JSON.parse(String(relaunchCall[1]?.body))).toEqual({ agentId: 'room-claude-abc123', mode: 'build' });
    // The row now shows the summoner's post-relaunch record.
    expect(document.body.textContent).toContain('Build — edits files and runs commands autonomously');
  });
});

// T-02: the info needed to locate and interact with an agent — the full
// terminal-access block plus the recovery prompt for an offline agent — must
// live on the details sheet, not only on the transient Summon screen.

const health = (over: Partial<ParticipantHealth> = {}): ParticipantHealth => ({
  name: 'ClaudeBuilder', client: 'cc', role: 'AI Agent',
  state: 'stale', lastSeenAgoMs: 120_000, listenRemainingMs: 0,
  ...over,
});

const ACCESS = [
  'Watch the live agent loop:  TMUX_TMPDIR=/x tmux attach -t sm-x   (detach: Ctrl-b then d)',
  'Resume this exact agent:  cd /tmp/ws && claude --resume abc-123',
  'Provider / model:  claude-corporate / claude-fable-5',
  'Workspace:  /tmp/ws',
];

async function waitLoaded() {
  await waitFor(() => {
    if (document.body.textContent?.includes('Loading')) throw new Error('still loading');
  });
}

describe('AgentDetailsSheet — terminal access + recovery (T-02)', () => {
  it('separates prose labels from copyable commands — the clipboard gets ONLY runnable code', async () => {
    const writeText = vi.fn(async () => {});
    mockAgentsResponse([summoned({ access: ACCESS })]);
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText } });
    render(<AgentDetailsSheet code="abc-def-ghj" participant={participant} onClose={() => {}} />);
    await waitLoaded();
    const section = document.querySelector('[data-gate="terminal-access"]')!;
    expect(section).not.toBeNull();
    // Labels render as text; the code chips hold bare commands — no label, no
    // "(detach…)" hint, and no provider/workspace prose rows at all.
    expect(section.textContent).toContain('Watch the live agent loop');
    expect(section.textContent).toContain('detach: Ctrl-b then d');
    const codes = [...section.querySelectorAll('li code')].map((c) => c.textContent);
    expect(codes).toEqual([
      'TMUX_TMPDIR=/x tmux attach -t sm-x',
      'cd /tmp/ws && claude --resume abc-123',
    ]);
    expect(section.textContent).not.toContain('Provider / model'); // fact, lives in identity
    // Per-line copy pastes exactly the runnable command…
    const rows = section.querySelectorAll('li');
    fireEvent.click([...rows[0]!.querySelectorAll('button')].find(b => b.textContent === 'Copy')!);
    expect(writeText).toHaveBeenCalledWith('TMUX_TMPDIR=/x tmux attach -t sm-x');
    // …and copy-all joins just the commands.
    fireEvent.click([...section.querySelectorAll('button')].find(b => b.textContent === 'Copy all')!);
    expect(writeText).toHaveBeenLastCalledWith('TMUX_TMPDIR=/x tmux attach -t sm-x\ncd /tmp/ws && claude --resume abc-123');
  });

  it('leads with the app bringing the agent back, and keeps the manual path as fallback', async () => {
    const writeText = vi.fn(async () => {});
    mockAgentsResponse([summoned({ access: ACCESS })]);
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText } });
    render(<AgentDetailsSheet code="abc-def-ghj" participant={participant} health={health({ state: 'disconnected' })} ended={false} onClose={() => {}} />);
    await waitLoaded();
    const banner = document.querySelector('[data-gate="recovery-banner"]')!;
    expect(banner).not.toBeNull();
    // The old copy told the host "the app can't restart a CLI process". It can,
    // for anything the summoner launched, and that claim must not come back.
    expect(banner.textContent).not.toContain("can't restart");
    expect(banner.querySelector('[data-gate="recovery-bring-back"]')).not.toBeNull();
    // The terminal prompt is still one click away, just no longer the headline.
    const manual = banner.querySelector('[data-gate="recovery-manual"]')!;
    expect(manual).not.toBeNull();
    fireEvent.click([...manual.querySelectorAll('button')].find(b => b.textContent === 'Copy wake message')!);
    expect(writeText).toHaveBeenCalledWith(recoveryPrompt('abc-def-ghj', 'ClaudeBuilder', 'AI Agent'));
  });

  it('tells the host to wait before offering to restart a merely quiet agent', async () => {
    mockAgentsResponse([summoned({ access: ACCESS })]);
    render(<AgentDetailsSheet code="abc-def-ghj" participant={participant} health={health({ state: 'stale' })} ended={false} onClose={() => {}} />);
    await waitLoaded();
    const banner = document.querySelector('[data-gate="recovery-banner"]')!;
    // A long turn reads exactly like a dead loop; restarting there discards work.
    expect(banner.querySelector('[data-gate="recovery-wait"]')!.textContent).toContain('long task');
    expect(banner.querySelector('[data-gate="recovery-bring-back"]')).not.toBeNull();
  });

  it('bring-back relaunches at the level the agent already had', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/summon/agents')) {
        return { ok: true, status: 200, json: async () => ({ agents: [summoned({ accessLevel: 'edit' })] }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ agent: summoned({ accessLevel: 'edit' }) }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentDetailsSheet code="abc-def-ghj" participant={participant} health={health({ state: 'disconnected' })} ended={false} onClose={() => {}} />);
    await waitLoaded();
    fireEvent.click(document.querySelector('[data-gate="recovery-bring-back"]') as HTMLButtonElement);
    await waitFor(() => {
      const call = (fetchMock.mock.calls as unknown as [string, RequestInit?][]).find(c => String(c[0]).includes('/api/summon/relaunch'));
      if (!call) throw new Error('no relaunch yet');
      // Never a defaulted level: reviving must not re-permission the agent.
      expect(JSON.parse(String(call[1]?.body))).toEqual({ agentId: 'room-claude-abc123', mode: 'edit' });
    });
  });

  it('offers no bring-back for an adopted agent, and explains instead', async () => {
    mockAgentsResponse([summoned({ access: ACCESS, adopted: true })]);
    render(<AgentDetailsSheet code="abc-def-ghj" participant={participant} health={health({ state: 'disconnected' })} ended={false} onClose={() => {}} />);
    await waitLoaded();
    const banner = document.querySelector('[data-gate="recovery-banner"]')!;
    expect(banner.querySelector('[data-gate="recovery-bring-back"]')).toBeNull();
    expect(banner.querySelector('[data-gate="recovery-blocked"]')!.textContent).toContain('already running when the app attached');
  });

  it('keeps diagnostics out of the way until asked for', async () => {
    mockAgentsResponse([summoned({ access: ACCESS })]);
    render(<AgentDetailsSheet code="abc-def-ghj" participant={participant} onClose={() => {}} />);
    await waitLoaded();
    // Who and where the agent is stays visible; the debug rows fold away.
    const technical = document.querySelector('[data-gate="technical-details"]') as HTMLDetailsElement;
    expect(technical).not.toBeNull();
    expect(technical.open).toBe(false);
    expect(technical.textContent).toContain('Persistent');
    expect((document.querySelector('[data-gate="terminal-access"]') as HTMLDetailsElement).open).toBe(false);
  });

  it('shows NO recovery banner while listening, and none after the room ended', async () => {
    mockAgentsResponse([summoned()]);
    render(<AgentDetailsSheet code="abc-def-ghj" participant={participant}
      health={health({ state: 'listening', listenRemainingMs: 60_000 })} ended={false} onClose={() => {}} />);
    await waitLoaded();
    expect(document.querySelector('[data-gate="recovery-banner"]')).toBeNull();

    cleanup();
    mockAgentsResponse([summoned()]);
    render(<AgentDetailsSheet code="abc-def-ghj" participant={participant} health={health()} ended={true} onClose={() => {}} />);
    await waitLoaded();
    expect(document.querySelector('[data-gate="recovery-banner"]')).toBeNull();
  });

  it('join-code agent (no summoner record) gets an honest explanation plus recovery, not a false-empty', async () => {
    mockAgentsResponse([]);
    render(<AgentDetailsSheet code="abc-def-ghj" participant={{ ...participant, workspace: '/Users/x/proj' }}
      health={health({ state: 'disconnected' })} ended={false} onClose={() => {}} />);
    await waitLoaded();
    const section = document.querySelector('[data-gate="terminal-access"]')!;
    expect(section.textContent).toContain('Joined via invite code');
    expect(section.textContent).toContain('/Users/x/proj');
    expect(document.querySelector('[data-gate="recovery-banner"]')).not.toBeNull();
  });

  // T-03: desktop control-center anatomy — facts and actions are separate
  // columns, and the presence verdict is a header chip, not a buried row.
  it('splits identity facts from the controls column and chips presence in the header', async () => {
    mockAgentsResponse([summoned({ access: ACCESS })]);
    render(<AgentDetailsSheet code="abc-def-ghj" participant={participant} onRemove={() => {}}
      health={health({ state: 'listening', listenRemainingMs: 60_000 })} ended={false} onClose={() => {}} />);
    await waitLoaded();
    const identity = document.querySelector('[data-gate="identity-col"]')!;
    const controls = document.querySelector('[data-gate="controls-col"]')!;
    expect(identity).not.toBeNull();
    expect(controls).not.toBeNull();
    expect(identity.textContent).toContain('Provider');
    expect(identity.textContent).toContain('Workspace');
    // Every ACTION surface lives in controls: permissions, terminal, removal.
    expect(controls.textContent).toContain('Permissions');
    expect([...controls.querySelectorAll('button')].some(b => b.textContent === 'Change')).toBe(true);
    expect(controls.querySelector('[data-gate="terminal-access"]')).not.toBeNull();
    expect(controls.querySelector('[data-gate="remove-from-room"]')).not.toBeNull();
    expect(identity.querySelector('[data-gate="terminal-access"], [data-gate="remove-from-room"]')).toBeNull();
    const chip = document.querySelector('[data-gate="presence-chip"]')!;
    expect(chip.textContent).toContain('Listening now');
  });

  // T-04: declared-busy is calm — the header chips "Working" and the scary
  // recovery banner stays away, even though nobody is listening right now.
  it('a working agent chips "Working" in the header with NO recovery banner', async () => {
    mockAgentsResponse([summoned()]);
    render(<AgentDetailsSheet code="abc-def-ghj" participant={participant}
      health={health({ state: 'working', lastSeenAgoMs: 120_000 })} ended={false} onClose={() => {}} />);
    await waitLoaded();
    expect(document.querySelector('[data-gate="presence-chip"]')!.textContent).toContain('Working');
    expect(document.querySelector('[data-gate="recovery-banner"]')).toBeNull();
  });

  it('a dismissed process keeps its access block but warns the tmux line is dead', async () => {
    mockAgentsResponse([summoned({ status: 'dismissed', dismissedAt: 2, access: ACCESS })]);
    render(<AgentDetailsSheet code="abc-def-ghj" participant={participant} onClose={() => {}} />);
    await waitLoaded();
    const section = document.querySelector('[data-gate="terminal-access"]')!;
    expect(section.textContent).toContain("won't attach");
    expect(section.textContent).toContain('claude --resume abc-123');
  });
});
