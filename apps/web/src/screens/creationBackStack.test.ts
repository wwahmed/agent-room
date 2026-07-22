import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// T-116: once room creation commits, the create form and lobby are dead
// intermediate states — every committed transition REPLACES its history
// entry so Back from inside a fresh room lands on Home. These guards pin
// the replace semantics at the source level; the live receipt drives the
// real flow in a browser and presses Back.
const create = readFileSync(new URL('./CreateMeeting.tsx', import.meta.url), 'utf8');
const lobby = readFileSync(new URL('./Lobby.tsx', import.meta.url), 'utf8');

describe('creation flow back-stack hygiene (T-116)', () => {
  it('create -> lobby replaces the committed create form', () => {
    expect(create).toContain("navigate(`/r/${code}/lobby`, { replace: true })");
  });

  it('lobby exits replace the lobby entry in both directions', () => {
    expect(lobby).toContain("navigate(`/r/${code}`, { replace: true })");
    expect(lobby).toContain("navigate('/', { replace: true })");
  });

  it('no committed transition pushes a plain history entry', () => {
    expect(create).not.toContain('navigate(`/r/${code}/lobby`);');
    expect(lobby).not.toContain('navigate(`/r/${code}`);');
  });
});
