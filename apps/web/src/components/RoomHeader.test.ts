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
    expect(header).toContain('More room actions');
    expect(rail).not.toContain('wakichat-icon-192.png');
    expect(pane).not.toContain('h-[60px]');
    expect(room).toContain('bg-surface-sunken pt-[52px] sm:pt-14');
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
  });
});
