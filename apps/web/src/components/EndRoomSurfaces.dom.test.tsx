// @vitest-environment jsdom
//
// P0 End truthfulness across ALL production surfaces, mounted together.
//
// The single-control harness proved the shared hook. It could not prove what
// Independent UX QA actually found: that the real `RoomHeader` rendered its own
// button from a bare callback + boolean, so a header-invoked failure was
// invisible on the Chat view and the menu item stayed enabled mid-request.
// This mounts the REAL RoomHeader alongside the settings and idle controls, all
// driven by one `useEndRoom`, exactly as Room.tsx composes them.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Room } from '@agent-room/shared';
import { RoomHeader } from './RoomHeader.js';
import { EndRoomAlert, EndRoomControl, useEndRoom } from './EndRoomControl.js';

afterEach(cleanup);

const ROOM = {
  code: 'rose-elk-wood', title: 'Test Room', status: 'active',
  createdBy: 'Alice', participants: [], messages: [],
} as unknown as Room;

/** The persistent room chrome plus the real tab surfaces, sharing one state. */
function Surfaces({
  isHost, onEnd, onEnded, mainTab = 'chat',
}: {
  isHost: boolean;
  onEnd: () => Promise<void>;
  onEnded?: () => void;
  mainTab?: 'chat' | 'room';
}) {
  const endRoomState = useEndRoom({ isHost, onEnd, onEnded: onEnded ?? (() => {}) });
  return (
    <MemoryRouter>
      <RoomHeader
        room={ROOM} ended={false} listeningCount={0} presentCount={1}
        inspectorOpen={false} onShare={() => {}} onToggleInspector={() => {}}
        onSearch={() => {}} onOpenRoom={() => {}}
        endRoom={endRoomState}
        selfName="Alice" agents={[]} agentStaleCount={0}
      />
      <EndRoomAlert state={endRoomState} mobileHeaderOffset={mainTab === 'chat'} />
      {mainTab === 'room' && (
        <section aria-label="settings">
          <EndRoomControl state={endRoomState} hideError label="End room" />
        </section>
      )}
      <section aria-label="chat" hidden={mainTab !== 'chat'}>
        <div aria-label="idle">
          <EndRoomControl state={endRoomState} hideError label="End meeting" />
        </div>
      </section>
    </MemoryRouter>
  );
}

const click = async (el: Element) => { await act(async () => { (el as HTMLButtonElement).click(); }); };

/** Open the header's overflow menu and return its End item. */
async function openHeaderEnd(): Promise<HTMLButtonElement | null> {
  await click(screen.getByRole('button', { name: 'More room actions' }));
  return screen.queryByRole('menuitem', { name: /End room/i }) as HTMLButtonElement | null;
}

describe('the real RoomHeader consumes the shared End state', () => {
  it('a nonhost sees no End entry on any surface', async () => {
    render(<Surfaces isHost={false} onEnd={vi.fn(async () => {})} />);
    await openHeaderEnd();
    expect(screen.queryByRole('menuitem', { name: /End room/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /End meeting/i })).toBeNull();
  });

  it('a header failure stays visible once in persistent chrome on Chat', async () => {
    const onEnd = vi.fn(async () => { throw new Error('Only the host can end this room.'); });
    const onEnded = vi.fn();
    render(<Surfaces isHost onEnd={onEnd} onEnded={onEnded} />);

    const item = await openHeaderEnd();
    expect(item, 'header End menu item not found').not.toBeNull();
    await click(item!);

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnded).not.toHaveBeenCalled();
    // Exactly one announcement, not one per mounted surface.
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toMatch(/ask the host/i);
    const region = alerts[0]!.closest('[data-room-persistent-end-alert]');
    expect(region).toBeTruthy();
    expect(region!.className).toContain('flex-shrink-0');
    expect(region!.className).toContain('mt-[96px]');
    expect(alerts[0]!.closest('[hidden]')).toBeNull();
    expect(alerts[0]!.closest('[aria-label="chat"]')).toBeNull();
  });

  it('a Settings failure stays visible outside the non-Chat tab pane', async () => {
    render(<Surfaces isHost mainTab="room" onEnd={vi.fn(async () => { throw new Error('Failed to fetch'); })} />);
    await click(within(screen.getByLabelText('settings')).getByRole('button', { name: 'End room' }));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/still active/i);
    const region = alert.closest('[data-room-persistent-end-alert]');
    expect(region).toBeTruthy();
    expect(region!.className).toContain('flex-shrink-0');
    expect(region!.className).not.toContain('mt-[96px]');
    expect(alert.closest('[hidden]')).toBeNull();
    expect(alert.closest('[aria-label="settings"]')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('the visible Settings and header surfaces share pending state and one request', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const onEnd = vi.fn(async () => { await gate; });
    render(<Surfaces isHost mainTab="room" onEnd={onEnd} />);

    const settings = within(screen.getByLabelText('settings')).getByRole('button');
    await click(settings);

    // Settings shows the pending label and aria-busy...
    const pending = screen.getAllByText('Ending…');
    expect(pending.length).toBeGreaterThanOrEqual(1);
    for (const el of pending) {
      expect((el as HTMLButtonElement).disabled).toBe(true);
      expect(el.getAttribute('aria-busy')).toBe('true');
    }

    // ...and the real header surface is disabled by the same request.
    await click(screen.getByRole('button', { name: 'More room actions' }));
    const item = screen.getByRole('menuitem', { name: 'Ending…' }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.getAttribute('aria-busy')).toBe('true');
    await click(item);
    expect(onEnd).toHaveBeenCalledTimes(1);

    await act(async () => { release(); await gate; });
  });

  it('the header End item is disabled and marked busy during a request', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    render(<Surfaces isHost onEnd={vi.fn(async () => { await gate; })} />);

    const item = await openHeaderEnd();
    expect(item).not.toBeNull();
    await click(item!);

    // The menu stays open while pending so the state is visible where it was
    // invoked, rather than closing onto a screen with no feedback.
    const stillThere = screen.queryAllByRole('menuitem').find(m => /Ending…/i.test(m.textContent ?? ''));
    expect(stillThere, 'header item should show pending state').toBeTruthy();
    expect((stillThere as HTMLButtonElement).disabled).toBe(true);
    expect(stillThere!.getAttribute('aria-busy')).toBe('true');

    await act(async () => { release(); await gate; });
  });

  it('a successful end transitions exactly once and shows no alert', async () => {
    const onEnded = vi.fn();
    render(<Surfaces isHost mainTab="room" onEnd={vi.fn(async () => {})} onEnded={onEnded} />);
    const settings = within(screen.getByLabelText('settings')).getByRole('button');
    await click(settings);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failure is retryable and the error clears on the next attempt', async () => {
    let fail = true;
    const onEnd = vi.fn(async () => { if (fail) throw new Error('Failed to fetch'); });
    const onEnded = vi.fn();
    render(<Surfaces isHost mainTab="room" onEnd={onEnd} onEnded={onEnded} />);

    const settings = within(screen.getByLabelText('settings')).getByRole('button');
    await click(settings);
    expect(screen.getByRole('alert').textContent).toMatch(/still active/i);
    // Controls are usable again, not stuck disabled.
    expect((within(screen.getByLabelText('settings')).getByRole('button') as HTMLButtonElement).disabled).toBe(false);

    fail = false;
    await click(within(screen.getByLabelText('settings')).getByRole('button'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('keeps the failed header action mounted, enabled, and focused for retry', async () => {
    let fail = true;
    const onEnd = vi.fn(async () => { if (fail) throw new Error('Failed to fetch'); });
    const onEnded = vi.fn();
    render(<Surfaces isHost onEnd={onEnd} onEnded={onEnded} />);

    const first = await openHeaderEnd();
    expect(first).not.toBeNull();
    first!.focus();
    await click(first!);

    const retry = await screen.findByRole('menuitem', { name: 'End room' });
    await waitFor(() => expect(document.activeElement).toBe(retry));
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getAllByRole('alert')).toHaveLength(1);

    fail = false;
    await click(retry);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(onEnd).toHaveBeenCalledTimes(2);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('no End path issues an attachment purge request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('unexpected network call');
    });
    try {
      const onEnd = vi.fn(async () => {});
      render(<Surfaces isHost mainTab="room" onEnd={onEnd} />);
      await click(within(screen.getByLabelText('settings')).getByRole('button'));
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('the standalone control keeps its own error as a full-width row', () => {
  it('renders the alert above the button inside a block wrapper', async () => {
    function Solo() {
      const state = useEndRoom({ isHost: true, onEnd: async () => { throw new Error('Failed to fetch'); }, onEnded: () => {} });
      return <div className="flex gap-2"><EndRoomControl state={state} /></div>;
    }
    render(<Solo />);
    await click(screen.getByRole('button'));
    const alert = screen.getByRole('alert');
    // The alert must not be a bare flex sibling of the button; it sits in the
    // control's own column wrapper so it reads as a full-width row above it.
    const wrapper = alert.parentElement!;
    expect(wrapper.className).toContain('flex-col');
    expect(wrapper.className).toContain('w-full');
    expect(wrapper.querySelector('button')).toBeTruthy();
    expect(Array.from(wrapper.children).indexOf(alert)).toBe(0);
  });
});
