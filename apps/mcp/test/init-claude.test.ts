import { describe, expect, it } from 'vitest';
import { ensureClaudeHookConfig } from '../src/init.js';

describe('ensureClaudeHookConfig', () => {
  it('replaces duplicate model-turn Stop hooks with one model-free rewake hook', () => {
    const wrapper = '/Users/test/.local/bin/agent-room-mcp-launch.sh';
    const hooks = ensureClaudeHookConfig({
      Stop: [
        { hooks: [{ type: 'command', command: `${wrapper} hook` }] },
        { hooks: [{ type: 'command', command: 'npx -y agent-room-mcp hook' }] },
        { hooks: [{ type: 'command', command: 'echo unrelated' }] },
      ],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: `${wrapper} hook` }] }],
    });

    const serialized = JSON.stringify(hooks);
    expect(serialized.match(/agent-room-mcp-launch\.sh hook --rewake/g)).toHaveLength(3);
    expect(serialized.match(/agent-room-mcp-launch\.sh hook"/g)).toHaveLength(2);
    expect(serialized).not.toContain('npx -y agent-room-mcp hook');
    expect(serialized).toContain('echo unrelated');
    for (const event of ['Stop', 'SubagentStop', 'TeammateIdle']) {
      const hook = (hooks[event] as any[]).flatMap(group => group.hooks)
        .find(row => String(row.command).includes('--rewake'));
      expect(hook).toMatchObject({ asyncRewake: true, timeout: 604_800 });
    }
  });

  it('is idempotent', () => {
    const first = ensureClaudeHookConfig({});
    expect(ensureClaudeHookConfig(first)).toEqual(first);
  });
});
