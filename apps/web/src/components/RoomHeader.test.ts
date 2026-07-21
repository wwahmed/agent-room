import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const header = readFileSync(new URL('./RoomHeader.tsx', import.meta.url), 'utf8');
const rail = readFileSync(new URL('./WorkspaceRail.tsx', import.meta.url), 'utf8');
const pane = readFileSync(new URL('./RoomListPane.tsx', import.meta.url), 'utf8');
const room = readFileSync(new URL('../screens/Room.tsx', import.meta.url), 'utf8');
const search = readFileSync(new URL('./CommandSearch.tsx', import.meta.url), 'utf8');

describe('room command bar composition', () => {
  it('uses one app-wide header aligned to the columns beneath it', () => {
    expect(header).toContain('app-command-bar fixed inset-x-0 top-0');
    expect(header).toContain('h-[52px]');
    expect(header).toContain('sm:h-14');
    expect(header).toContain('aria-label="Room actions"');
    expect(header).toContain('WakiChat');
    expect(header).toContain('Search rooms, messages, tasks…');
    expect(header).toContain('AgentFacepile');
    expect(header).toContain('header-team-pill');
    // T-71 pixel ruling 5: the pill is facepile + ONE human-readable status.
    expect(header).toContain('{agentStatus}');
    expect(header).not.toContain("agentCount === 1 ? 'agent' : 'agents'");
    expect(header).toContain('header-room-presence');
    expect(header).toContain('header-search-field');
    expect(header).toContain('header-glass-control');
    expect(header).not.toContain('title="Copy invite link"');
    expect(header).toContain('More room actions');
    expect(rail).not.toContain('wakichat-icon-192.png');
    expect(pane).not.toContain('h-[60px]');
    // T-71: in-room mobile chrome is the 96px two-row header shell
    // (52px identity + 44px workspace switcher), one row at lg+; the
    // full-screen mobile Settings page returns chrome to 52px.
    expect(room).toContain("mainTab === 'room' ? 'pt-[52px]' : 'pt-[96px]'");
    expect(header).toContain('workspaceNav');
    expect(header).toContain('mobileNavHidden');
  });

  it('keeps mobile navigation and touch-size header actions', () => {
    expect(header).toContain('aria-label="Back to rooms"');
    expect(header).toContain('h-11 w-11');
    expect(header).toContain('md:hidden');
    expect(header).toContain('hidden h-11 w-[min(320px,28vw)]');
    expect(header).toContain('group min-h-11 min-w-0');
  });

  it('opens a real keyboard-accessible search instead of a decorative field', () => {
    expect(room).toContain("event.key.toLocaleLowerCase() === 'k'");
    expect(room).toContain('<CommandSearch');
    expect(search).toContain('fetch(`/api/search?${params}`');
    expect(search).toContain("hits.filter(hit => hit.type === 'room')");
    expect(search).toContain("hits.filter(hit => hit.type === 'message')");
    expect(search).toContain("hits.filter(hit => hit.type === 'task')");
    expect(search).toContain("event.key !== 'Tab'");
    expect(search).toContain('returnFocusRef.current?.focus()');
    expect(search).toContain('command-search-palette');
    expect(search).toContain('top-1.5');
  });
});
