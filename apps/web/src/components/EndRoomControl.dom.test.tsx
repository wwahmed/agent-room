// @vitest-environment jsdom
//
// P0 End truthfulness — EXECUTED as interactions, not source assertions.
//
// The defect: `handleEndMeeting`'s catch set ended=true on every failure, so a
// nonhost's rejected End rendered a live room as finished. These drive the real
// control and assert what a person would see.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { EndRoomAlert, EndRoomControl, useEndRoom } from './EndRoomControl.js';

afterEach(cleanup);

/** Mounts the real hook + control exactly as Room.tsx composes them. */
function Harness({ isHost, onEnd, onEnded }: { isHost: boolean; onEnd: () => Promise<void>; onEnded: () => void }) {
  const state = useEndRoom({ isHost, onEnd, onEnded });
  return <EndRoomControl state={state} />;
}

function setup(over: { isHost?: boolean; onEnd?: () => Promise<void>; onEnded?: () => void } = {}) {
  const onEnd = over.onEnd ?? vi.fn(async () => {});
  const onEnded = over.onEnded ?? vi.fn();
  render(<Harness isHost={over.isHost ?? true} onEnd={onEnd} onEnded={onEnded} />);
  return { onEnd, onEnded };
}

const click = async (el: Element) => {
  await act(async () => { (el as HTMLButtonElement).click(); });
};

describe('a nonhost is never offered End', () => {
  it('renders no End control at all', () => {
    const { onEnd } = setup({ isHost: false });
    expect(screen.queryByRole('button')).toBeNull();
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe('only an authoritative success ends the room', () => {
  it('transitions once on success', async () => {
    const { onEnd, onEnded } = setup();
    await click(screen.getByRole('button'));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  const failures: Array<[string, unknown]> = [
    ['an HTTP refusal', new Error('Only the host can end this room.')],
    ['a network throw', new Error('Failed to fetch')],
    ['a malformed response', new SyntaxError('Unexpected token < in JSON at position 0')],
  ];

  for (const [label, thrown] of failures) {
    it(`keeps the room active and shows an alert on ${label}`, async () => {
      const onEnd = vi.fn(async () => { throw thrown; });
      const { onEnded } = setup({ onEnd });
      await click(screen.getByRole('button'));

      // The room must NOT be reported as ended.
      expect(onEnded).not.toHaveBeenCalled();
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(/still active|already ended/i);
      // The control stays usable so the user can retry.
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
    });
  }

  it('never renders raw exception text', async () => {
    const onEnd = vi.fn(async () => {
      throw new Error('FetchError: request to https://internal.host:8210/api/room failed at /Users/x/secret.js');
    });
    setup({ onEnd });
    await click(screen.getByRole('button'));
    const shown = screen.getByRole('alert').textContent ?? '';
    expect(shown).not.toContain('https://');
    expect(shown).not.toContain('/Users/');
    expect(shown).not.toContain('internal.host');
  });

  it('clears a prior error when a new attempt starts', async () => {
    let fail = true;
    const onEnd = vi.fn(async () => { if (fail) throw new Error('Failed to fetch'); });
    const { onEnded } = setup({ onEnd });
    await click(screen.getByRole('button'));
    expect(screen.getByRole('alert')).toBeTruthy();

    fail = false;
    await click(screen.getByRole('button'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});

describe('an in-flight end cannot be issued twice', () => {
  it('a double click sends exactly one request', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const onEnd = vi.fn(async () => { await gate; });
    const { onEnded } = setup({ onEnd });

    const btn = screen.getByRole('button');
    // Two clicks before the first resolves.
    await act(async () => {
      (btn as HTMLButtonElement).click();
      (btn as HTMLButtonElement).click();
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
    const btnNow = screen.getByRole('button') as HTMLButtonElement;
    expect(btnNow.disabled).toBe(true);
    expect(btnNow.getAttribute('aria-busy')).toBe('true');
    expect(btnNow.textContent).toBe('Ending…');

    await act(async () => { release(); await gate; });
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('re-enables after a failure so the user is not stuck', async () => {
    const onEnd = vi.fn(async () => { throw new Error('Failed to fetch'); });
    setup({ onEnd });
    await click(screen.getByRole('button'));
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('a shared alert covers surfaces that render no control', () => {
  // Room's header invokes the end handler but renders no EndRoomControl. With
  // per-control errors only, a header-initiated failure was silent.
  function SharedAlertHarness({ onEnd }: { onEnd: () => Promise<void> }) {
    const state = useEndRoom({ isHost: true, onEnd, onEnded: () => {} });
    return (
      <>
        <EndRoomAlert state={state} />
        {/* Two controls that defer their error to the shared banner. */}
        <EndRoomControl state={state} hideError label="End meeting" />
        <EndRoomControl state={state} hideError label="End room" />
        {/* A header-style invoker with no control of its own. */}
        <button type="button" onClick={() => { void state.endRoom(); }}>Header End</button>
      </>
    );
  }

  it('a header-initiated failure is visible exactly once', async () => {
    const onEnd = vi.fn(async () => { throw new Error('Only the host can end this room.'); });
    render(<SharedAlertHarness onEnd={onEnd} />);
    await click(screen.getByText('Header End'));
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toMatch(/ask the host/i);
  });

  it('all End affordances disable together while one is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    render(<SharedAlertHarness onEnd={async () => { await gate; }} />);
    await act(async () => { (screen.getByText('End meeting') as HTMLButtonElement).click(); });
    // Both shared controls now read "Ending…" and are disabled + aria-busy.
    const pending = screen.getAllByText('Ending…');
    expect(pending).toHaveLength(2);
    for (const el of pending) {
      expect((el as HTMLButtonElement).disabled).toBe(true);
      expect(el.getAttribute('aria-busy')).toBe('true');
    }
    await act(async () => { release(); await gate; });
  });

  it('a second surface cannot issue a duplicate request mid-flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const onEnd = vi.fn(async () => { await gate; });
    render(<SharedAlertHarness onEnd={onEnd} />);
    await act(async () => {
      (screen.getByText('End meeting') as HTMLButtonElement).click();
      (screen.getByText('Header End') as HTMLButtonElement).click();
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await gate; });
  });
});

describe('ending issues no attachment purge', () => {
  it('performs no fetch of its own beyond the injected end call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('unexpected network call');
    });
    try {
      const { onEnd } = setup();
      await click(screen.getByRole('button'));
      expect(onEnd).toHaveBeenCalledTimes(1);
      // No purge, no cleanup, no side-channel request.
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
