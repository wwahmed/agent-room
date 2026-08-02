import { describe, expect, it } from 'vitest';
import { ensureCodexHarnessConfig } from '../src/init.js';

describe('ensureCodexHarnessConfig', () => {
  it('adds the stable Codex identity to a fresh MCP block and all hooks', () => {
    const before = '[mcp_servers.agent-room]\ncommand = "npx"\nargs = ["-y", "agent-room-mcp"]\n';
    const { content, changed } = ensureCodexHarnessConfig(before, { hooks: true });

    expect(changed).toBe(true);
    expect(content).toContain('[mcp_servers.agent-room.env]\nAGENT_ROOM_HARNESS = "codex"');
    for (const event of ['Stop', 'UserPromptSubmit', 'SessionStart']) {
      expect(content).toContain(`[[hooks.${event}]]`);
    }
    expect(content.match(/command = "AGENT_ROOM_HARNESS=codex npx -y agent-room-mcp hook"/g)).toHaveLength(3);
  });

  it('repairs a custom launcher, preserves its agent file, and removes duplicate managed hooks', () => {
    const before = `[mcp_servers.agent-room]
command = "/custom/agent-room-mcp-launch.sh"
args = []

[mcp_servers.agent-room.env]
WAKICHAT_AGENT_FILE = "/custom/codex-agent"

[[hooks.Stop]]
matcher = ""
[[hooks.Stop.hooks]]
type = "command"
command = "WAKICHAT_AGENT_FILE=/custom/codex-agent /custom/agent-room-mcp-launch.sh hook"

[[hooks.Stop]]
matcher = ""
[[hooks.Stop.hooks]]
type = "command"
command = "npx -y agent-room-mcp hook"
`;
    const { content } = ensureCodexHarnessConfig(before, { hooks: true });

    expect(content).toContain('command = "/custom/agent-room-mcp-launch.sh"');
    expect(content).toContain('WAKICHAT_AGENT_FILE = "/custom/codex-agent"');
    expect(content).toContain('AGENT_ROOM_HARNESS = "codex"');
    expect(content).toContain('command = "AGENT_ROOM_HARNESS=codex WAKICHAT_AGENT_FILE=/custom/codex-agent /custom/agent-room-mcp-launch.sh hook"');
    expect(content.match(/\[\[hooks\.Stop\]\]/g)).toHaveLength(1);
    expect(content).not.toContain('command = "npx -y agent-room-mcp hook"');
  });

  it('is idempotent', () => {
    const first = ensureCodexHarnessConfig('[mcp_servers.agent-room]\ncommand = "npx"\n', { hooks: true });
    const second = ensureCodexHarnessConfig(first.content, { hooks: true });
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });
});
