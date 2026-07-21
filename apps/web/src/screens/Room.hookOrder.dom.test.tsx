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
  it('loading -> loaded renders in ONE mounted tree without a hook-order crash', async () => {
    const h = await mountRoomAt({ room: null });
    expect(document.body.textContent).toContain('Loading the room');
    // The #310 crash fired exactly here: the loaded render mounted an extra
    // hook that the loading render had skipped.
    await h.transitionTo({ room: loadedRoom });
    expect(document.querySelector('textarea')).not.toBeNull();
    expect(document.querySelector('[data-gate="feed"]')).not.toBeNull();
  });

  it('error -> retry -> loaded is hook-order stable too', async () => {
    const h = await mountRoomAt({ room: null, error: 'Connection failed' });
    expect(document.body.textContent).toMatch(/couldn.t load|retry/i);
    await h.transitionTo({ room: null }); // retrying: back to loading
    await h.transitionTo({ room: loadedRoom });
    expect(document.querySelector('textarea')).not.toBeNull();
  });
});
