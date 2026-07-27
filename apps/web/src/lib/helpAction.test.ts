import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const room = readFileSync(new URL('../screens/Room.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');

// T-10: the Get-help control and its wire. Source-contract tests in the same
// style as the invite/create pins.
describe('Get help — page the platform admin from any room', () => {
  it('the room UI carries the Get help control wired to the API', () => {
    expect(room).toContain('data-gate="get-help"');
    expect(room).toContain('requestAdminHelp(code, self.name)');
    expect(room).toContain("has been paged — they'll join shortly");
  });

  it('the API client posts the requestAdminHelp action', () => {
    expect(api).toContain("action: 'requestAdminHelp'");
  });
});

// T-13: the ghost sweep — host-only, confirmed, and wired to the API.
describe('Sweep ghost agents — one host tap clears disconnected rows', () => {
  it('the People pane carries the host-gated sweep control with a confirm', () => {
    expect(room).toContain('data-gate="sweep-ghosts"');
    expect(room).toContain('room.createdBy === self.name && ghostAgentNames.length > 0');
    expect(room).toContain('window.confirm');
    expect(room).toContain('sweepGhostAgents(code)');
  });

  it('the API client posts the sweepGhostAgents action with the host proof', () => {
    expect(api).toContain("action: 'sweepGhostAgents'");
    expect(api.slice(api.indexOf("action: 'sweepGhostAgents'"))).toContain('hostKey: storedHostKey(code)');
  });
});
