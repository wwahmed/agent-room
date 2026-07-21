// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Room as RoomType } from '@agent-room/shared';

// T-83 regression: React invariant #310 took every production Room down
// because a T-82 effect sat below the bootstrap early returns — the loading
// render mounted fewer hooks than the loaded render. This test drives the
// REAL Room component through loading -> loaded (and error -> loaded) in one
// mounted tree; any conditional hook crashes the transition render.

let hookState: Record<string, unknown> = {};
vi.mock('../hooks/useRoom.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  useRoom: () => hookState,
}));

// Ambient fetches from Room's data effects (board, artifacts, health,
// questions) get inert empty answers; their shapes are all null-tolerated.
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({}),
  text: async () => '',
})));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const baseHook = {
  messages: [],
  error: null,
  degraded: false,
  sendMessage: async () => {},
  refreshRoom: async () => {},
  forceRefresh: async () => {},
  messageTotal: 0,
  hasOlder: false,
  loadingOlder: false,
  loadOlder: async () => 0,
};

const loadedRoom = {
  code: 'AAA-BBB-CCC',
  topic: 'Fixture room',
  createdAt: 1,
  createdBy: 'Waqas',
  status: 'active',
  version: 1,
  participants: [
    { name: 'ClaudeUI', client: 'web', role: '', initials: 'CU', color: '#5B6AFF', joinedAt: 1, lastSeenAt: 1 },
  ],
} as unknown as RoomType;

function mountRoomAt(initial: Record<string, unknown>) {
  hookState = { ...baseHook, ...initial };
  sessionStorage.setItem('room:AAA-BBB-CCC:self', JSON.stringify({ name: 'ClaudeUI', role: '' }));
  let RoomComponent: React.ComponentType;
  return (async () => {
    ({ Room: RoomComponent } = await import('./Room.js'));
    const ui = () => (
      <MemoryRouter initialEntries={['/r/AAA-BBB-CCC']}>
        <Routes>
          <Route path="/r/:code" element={<RoomComponent />} />
        </Routes>
      </MemoryRouter>
    );
    const r = render(ui());
    return {
      ...r,
      transitionTo: async (next: Record<string, unknown>) => {
        hookState = { ...baseHook, ...next };
        await act(async () => { r.rerender(ui()); });
      },
    };
  })();
}

afterEach(() => cleanup());

describe('Room hook-order stability across bootstrap transitions', () => {
  it('loading -> loaded renders in ONE mounted tree without a hook-order crash', { timeout: 20000 }, async () => {
    const h = await mountRoomAt({ room: null });
    expect(document.body.textContent).toContain('Loading the room');
    // The #310 crash fired exactly here: the loaded render mounted an extra
    // hook that the loading render had skipped.
    await h.transitionTo({ room: loadedRoom });
    expect(document.querySelector('textarea')).not.toBeNull();
    expect(document.querySelector('[data-gate="feed"]')).not.toBeNull();
  });

  it('error -> retry -> loaded is hook-order stable too', { timeout: 20000 }, async () => {
    const h = await mountRoomAt({ room: null, error: 'Connection failed' });
    expect(document.body.textContent).toMatch(/couldn.t load|retry/i);
    await h.transitionTo({ room: null }); // retrying: back to loading
    await h.transitionTo({ room: loadedRoom });
    expect(document.querySelector('textarea')).not.toBeNull();
  });

  it('same-tree Chat -> Project -> People -> Outputs -> Chat keeps hook order stable', { timeout: 20000 }, async () => {
    await mountRoomAt({ room: loadedRoom });
    const tab = (label: string) => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label);
      expect(btn, `workspace tab "${label}"`).toBeTruthy();
      return btn!;
    };
    for (const label of ['Project', 'People', 'Outputs', 'Chat']) {
      await act(async () => { tab(label).click(); });
      expect(document.querySelector('[data-gate="feed"], main, [role="tablist"]')).not.toBeNull();
    }
    expect(document.querySelector('textarea')).not.toBeNull(); // back in chat
  });

  it('Home -> Room -> Back -> reopen mounts and remounts cleanly', { timeout: 20000 }, async () => {
    hookState = { ...baseHook, room: loadedRoom };
    sessionStorage.setItem('room:AAA-BBB-CCC:self', JSON.stringify({ name: 'ClaudeUI', role: '' }));
    const { Room: RoomComponent } = await import('./Room.js');
    const { useNavigate } = await import('react-router-dom');
    const navRef: { current: ((to: string | number) => void) | null } = { current: null };
    function NavBridge() { navRef.current = useNavigate() as (to: string | number) => void; return null; }
    render(
      <MemoryRouter initialEntries={['/']}>
        <NavBridge />
        <Routes>
          <Route path="/" element={<div>HOME SURFACE</div>} />
          <Route path="/r/:code" element={<RoomComponent />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(document.body.textContent).toContain('HOME SURFACE');
    await act(async () => { navRef.current!('/r/AAA-BBB-CCC'); });
    expect(document.querySelector('textarea')).not.toBeNull();
    await act(async () => { navRef.current!(-1); }); // browser Back
    expect(document.body.textContent).toContain('HOME SURFACE');
    await act(async () => { navRef.current!('/r/AAA-BBB-CCC'); }); // reopen
    expect(document.querySelector('textarea')).not.toBeNull();
  });
});
