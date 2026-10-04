import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeLaunchSpec } from './providers.mjs';

test('summoned Claude uses one session state file and background rewake hooks', () => {
  const spec = nativeLaunchSpec({
    provider: 'claude-personal', model: '', workspace: '/tmp/work', mode: 'chat',
    name: 'Claude', role: 'Reviewer', code: 'cafe-ham-clog', sessionId: 'session-1',
    account: '', mcpConfigPath: '/tmp/agent-room.mcp.json',
    stateFile: '/tmp/room-state.json', settingsPath: '/tmp/claude-settings.json',
  });
  assert.ok(spec);
  assert.equal(spec.env.AGENT_ROOM_STATE_FILE, '/tmp/room-state.json');
  assert.equal(spec.env.AGENT_ROOM_HARNESS, 'claude-code');
  assert.ok(spec.args.includes('--settings'));
  assert.ok(spec.args.includes('--setting-sources'));

  const systemPrompt = spec.args[spec.args.indexOf('--append-system-prompt') + 1];
  assert.match(systemPrompt, /requestAuthority="access_authenticated_owner"/);
  assert.match(systemPrompt, /direct user request/);

  const mcp = JSON.parse(spec.files.find(file => file.path.endsWith('.mcp.json')).content);
  assert.equal(mcp.mcpServers['agent-room'].env.AGENT_ROOM_STATE_FILE, '/tmp/room-state.json');

  const settings = JSON.parse(spec.files.find(file => file.path.endsWith('claude-settings.json')).content);
  for (const event of ['Stop', 'SubagentStop', 'TeammateIdle']) {
    const hook = settings.hooks[event][0].hooks[0];
    assert.equal(hook.asyncRewake, true);
    assert.match(hook.command, /hook.*--rewake/);
  }
});
