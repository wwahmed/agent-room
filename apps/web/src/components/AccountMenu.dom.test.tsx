// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { AccountMenu } from './AccountMenu.js';

// T-26/T-27: the account menu owns every personal action. These tests drive
// the real DOM contract — open/dismiss, focus return, arrow traversal, and
// the persistence side effects of the theme and reading-scale rows.

beforeEach(() => {
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.dataset.readingScale = 'comfortable';
});
afterEach(() => cleanup());

function open() {
  const utils = render(<AccountMenu name="Waqas" email="w@wakilabs.dev" onOpenSettings={vi.fn()} />);
  const trigger = document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
  fireEvent.click(trigger);
  return { ...utils, trigger };
}

describe('AccountMenu', () => {
  it('opens from the avatar with identity, Settings, theme, scale, and Log out', () => {
    open();
    const menu = document.querySelector('[role="menu"][aria-label="Account"]')!;
    expect(menu.textContent).toContain('Waqas');
    expect(menu.textContent).toContain('w@wakilabs.dev');
    expect(menu.textContent).toContain('Settings');
    expect(menu.textContent).toContain('Light mode'); // dark theme offers light
    expect(menu.textContent).toContain('Reading scale');
    const logout = menu.querySelector<HTMLAnchorElement>('a[href="/cdn-cgi/access/logout"]')!;
    expect(logout.textContent).toContain('Log out');
    expect(logout.className).toContain('text-red-400'); // destructive separation
  });

  it('Escape closes the menu and returns focus to the avatar trigger', () => {
    const { trigger } = open();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('outside pointer-down dismisses; inside clicks do not', () => {
    open();
    fireEvent.mouseDown(document.querySelector('[role="menu"]')!);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('arrow keys cycle focus through the menu rows', () => {
    open();
    const rows = [...document.querySelectorAll<HTMLElement>('[data-menu-row]')];
    expect(rows.length).toBeGreaterThan(3);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(document, { key: 'ArrowUp' }); // wraps to the end
    expect(document.activeElement).toBe(rows[rows.length - 1]);
  });

  it('Settings row invokes the callback and closes the menu', () => {
    const onOpenSettings = vi.fn();
    render(<AccountMenu name="Waqas" onOpenSettings={onOpenSettings} />);
    fireEvent.click(document.querySelector('[aria-haspopup="menu"]')!);
    const settings = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Settings'))!;
    fireEvent.click(settings);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('without a Settings callback (Home) the row is absent entirely', () => {
    render(<AccountMenu name="Waqas" />);
    fireEvent.click(document.querySelector('[aria-haspopup="menu"]')!);
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu.textContent).not.toContain('Settings');
  });

  it('theme row flips data-theme and persists the choice', () => {
    open();
    const themeRow = document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!;
    fireEvent.click(themeRow);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('wakichat:theme')).toBe('light');
    expect(themeRow.textContent).toContain('Dark mode'); // now offers the way back
  });

  it('reading-scale radios stamp the root attribute and persist', () => {
    open();
    const radios = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map(r => r.textContent)).toEqual(['Comfortable', 'Large', 'Compact']);
    expect(radios[0]!.getAttribute('aria-checked')).toBe('true'); // Comfortable default
    fireEvent.click(radios[1]!);
    expect(document.documentElement.dataset.readingScale).toBe('large');
    expect(localStorage.getItem('wakichat:reading-scale')).toBe('large');
    expect(radios[1]!.getAttribute('aria-checked')).toBe('true');
  });
});
