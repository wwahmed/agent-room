// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { listMessages } from '../lib/api.js';
import { markRoomRead } from '../lib/unread.js';
import { RoomBadges } from './RoomBadges.js';

vi.mock('../lib/api.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  listMessages: vi.fn(),
}));

const mockedListMessages = vi.mocked(listMessages);

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe('RoomBadges unread row marker', () => {
  it('tracks read to refined unread to opened on the actual rendered badge', async () => {
    const code = 'ROW-ONE';
    markRoomRead(code, 10, 'Waqas');
    mockedListMessages.mockResolvedValueOnce([
      { id: 11, type: 'msg', client: 'cc', name: 'Claude', text: 'New work' },
    ] as never);

    const view = render(<RoomBadges code={code} messageCount={10} selfName="Waqas" />);
    expect(view.container.querySelector('[data-unread-badge]')).toBeNull();

    view.rerender(<RoomBadges code={code} messageCount={11} selfName="Waqas" />);
    await waitFor(() => expect(view.container.querySelector('[data-unread-badge]')).not.toBeNull());

    view.rerender(<RoomBadges code={code} messageCount={11} selfName="Waqas" active />);
    await waitFor(() => expect(view.container.querySelector('[data-unread-badge]')).toBeNull());
  });

  it('removes row emphasis when the refined window contains only self and status noise', async () => {
    const code = 'ROW-NOISE';
    markRoomRead(code, 20, 'Waqas');
    mockedListMessages.mockResolvedValueOnce([
      { id: 21, type: 'msg', client: 'web', name: 'Waqas', text: 'Mine' },
      { id: 22, type: 'msg', client: 'cc', name: 'Codex', text: 'on it', metadata: { kind: 'status' } },
    ] as never);

    const view = render(<RoomBadges code={code} messageCount={22} selfName="Waqas" />);
    await waitFor(() => expect(view.container.querySelector('[data-unread-badge]')).toBeNull());
    expect(mockedListMessages).toHaveBeenCalledTimes(1);
  });
});
