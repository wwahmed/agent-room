// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import type { Room } from '@agent-room/shared';
import { ProjectPanel } from './ProjectPanel.js';
import type { BoardTask } from '../lib/api.js';

// T-71 Project rev2 (design lead): REAL DOM interaction proof — deep-link
// focus, re-entry after the query clears, cross-room identity, and Retry
// isolation — rendered, not helper-table claims.

// jsdom has no scrollIntoView; the landing path calls it before focus.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

vi.mock('../lib/api.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  listProjects: async () => [],
  listProjectCandidates: async () => [],
  readProjectDoc: async () => null,
}));

const room = (code: string): Room => ({ code, topic: 'Fixture', createdAt: 1, createdBy: 'Host', status: 'active', version: 1, participants: [], projectId: 'proj-1' } as unknown as Room);
const tasks: BoardTask[] = [
  { id: 'T-1', title: 'First task', state: 'todo', createdBy: 'A', owner: 'A' },
  { id: 'T-2', title: 'Second task', state: 'awaiting_review', createdBy: 'B', owner: 'B', verifier: 'A' },
];

function mount(code: string, url: string, extra: Partial<Parameters<typeof ProjectPanel>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ProjectPanel room={room(code)} isHost selfName="A" onAttached={() => {}} board={tasks} {...extra} />
    </MemoryRouter>,
  );
}

// Harness for SAME-MOUNTED-TREE navigation: the router persists, navigate()
// drives the URL, and rerendering with a different room prop reconciles the
// panel without unmounting (design lead: unmount/remount trivially resets
// refs and proves nothing).
const navRef: { current: ((to: string) => void) | null } = { current: null };
function NavBridge() {
  navRef.current = useNavigate();
  return null;
}
function mountNavigable(code: string, url: string) {
  const ui = (c: string) => (
    <MemoryRouter initialEntries={[url]}>
      <NavBridge />
      <ProjectPanel room={room(c)} isHost selfName="A" onAttached={() => {}} board={tasks} />
    </MemoryRouter>
  );
  const r = render(ui(code));
  return { ...r, setRoom: (c: string) => r.rerender(ui(c)) };
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ProjectPanel DOM interactions', () => {
  it('deep link focuses the exact task row once, with the landing flash', async () => {
    vi.useFakeTimers();
    mount('AAA', '/r/AAA?panel=project&task=T-2');
    await vi.advanceTimersByTimeAsync(120);
    const row = document.getElementById('task-T-2')!;
    expect(document.activeElement).toBe(row);
    expect(row.className).toContain('reply-flash');
    await vi.advanceTimersByTimeAsync(2500);
    expect(row.className).not.toContain('reply-flash');
  });

  it('IN ONE MOUNTED TREE: clear the URL, reopen the same task, it focuses again', async () => {
    vi.useFakeTimers();
    mountNavigable('AAA', '/r/AAA?panel=project&task=T-1');
    await vi.advanceTimersByTimeAsync(120);
    expect(document.activeElement).toBe(document.getElementById('task-T-1'));
    (document.activeElement as HTMLElement).blur();
    navRef.current!('/r/AAA?panel=project'); // clear WITHOUT unmounting
    await vi.advanceTimersByTimeAsync(120);
    navRef.current!('/r/AAA?panel=project&task=T-1'); // re-enter
    await vi.advanceTimersByTimeAsync(120);
    expect(document.activeElement).toBe(document.getElementById('task-T-1'));
  });

  it('IN ONE MOUNTED TREE: switching room with the same task id focuses via the room|task key', async () => {
    vi.useFakeTimers();
    const h = mountNavigable('AAA', '/r/AAA?panel=project&task=T-1');
    await vi.advanceTimersByTimeAsync(120);
    expect(document.activeElement).toBe(document.getElementById('task-T-1'));
    (document.activeElement as HTMLElement).blur();
    h.setRoom('BBB'); // same mounted tree, room prop changes, refs survive
    await vi.advanceTimersByTimeAsync(120);
    expect(document.activeElement).toBe(document.getElementById('task-T-1'));
  });

  it('navigating away MID-FLASH removes the highlight immediately (no stranded class)', async () => {
    vi.useFakeTimers();
    mountNavigable('AAA', '/r/AAA?panel=project&task=T-1');
    await vi.advanceTimersByTimeAsync(120); // focus + flash applied
    const row = document.getElementById('task-T-1')!;
    expect(row.className).toContain('reply-flash');
    navRef.current!('/r/AAA?panel=project'); // clear during the 2s flash
    await vi.advanceTimersByTimeAsync(10);
    expect(row.className).not.toContain('reply-flash');
  });

  it('unmount before landing cleans the timers: nothing focuses or flashes afterwards', async () => {
    vi.useFakeTimers();
    const a = mount('AAA', '/r/AAA?panel=project&task=T-1');
    a.unmount(); // before the 50ms landing timer fires
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.activeElement === document.body || document.activeElement === null).toBe(true);
  });

  it('Retry invokes only the board retry callback (Room-level fetch isolation is the split effects)', () => {
    const onRetryBoard = vi.fn();
    const artifactsSpy = vi.fn();
    render(
      <MemoryRouter initialEntries={['/r/AAA?panel=project']}>
        <ProjectPanel room={room('AAA')} isHost selfName="A" onAttached={artifactsSpy} board={null} boardError onRetryBoard={onRetryBoard} />
      </MemoryRouter>,
    );
    const retry = [...document.querySelectorAll('button')].find(b => b.textContent === 'Retry')!;
    fireEvent.click(retry);
    expect(onRetryBoard).toHaveBeenCalledTimes(1);
    expect(artifactsSpy).not.toHaveBeenCalled();
  });

  it('error state renders no numeric counts and disabled controls', () => {
    render(
      <MemoryRouter initialEntries={['/r/AAA?panel=project']}>
        <ProjectPanel room={room('AAA')} isHost selfName="A" onAttached={() => {}} board={null} boardError onRetryBoard={() => {}} />
      </MemoryRouter>,
    );
    const switchButtons = [...document.querySelectorAll('[role="tablist"][aria-label="Task views"] button')];
    expect(switchButtons.every(b => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(switchButtons.some(b => /\d/.test(b.textContent ?? ''))).toBe(false);
  });
});
