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
