// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { AccountMenu } from './AccountMenu.js';
import { watchSystemTheme } from '../lib/theme.js';

// T-26/T-27 rev2: the popover is a DIALOG with natural Tab order and compact
// disclosure rows; Appearance is a three-way System/Light/Dark radiogroup in
// a subpanel; System follows the device live. These tests drive the real DOM
// contract including the persistence and live-following side effects.

beforeEach(() => {
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.dataset.readingScale = 'comfortable';
});
afterEach(() => cleanup());

function open(onOpenSettings = vi.fn()) {
  const utils = render(<AccountMenu name="Waqas" email="w@wakilabs.dev" onOpenSettings={onOpenSettings} />);
  const trigger = document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
  fireEvent.click(trigger);
  return { ...utils, trigger, onOpenSettings };
}

const dialog = () => document.querySelector('[role="dialog"][aria-label="Account"]');

describe('AccountMenu (dialog anatomy)', () => {
  it('opens a dialog with identity, Settings, compact preference rows, and separated Log out', () => {
    open();
    const d = dialog()!;
    expect(d.textContent).toContain('Waqas');
    expect(d.textContent).toContain('w@wakilabs.dev');
    expect(d.textContent).toContain('Settings');
    // Compact rows show the CURRENT value, no expanded control at rest.
    expect(d.textContent).toContain('Appearance');
    expect(d.textContent).toContain('System'); // default for new users
    expect(d.textContent).toContain('Reading scale');
    expect(d.textContent).toContain('Comfortable');
    expect(d.querySelector('[role="radiogroup"]')).toBeNull(); // disclosed on intent only
    const logout = d.querySelector<HTMLAnchorElement>('a[href="/cdn-cgi/access/logout"]')!;
    expect(logout.textContent).toContain('Log out');
    expect(logout.className).toContain('text-red-400');
    expect(logout.querySelector('svg')).not.toBeNull(); // exit-door SVG, not a text glyph
    expect(logout.textContent).not.toContain('⎋');
  });

  it('Escape closes and returns focus to the avatar trigger', () => {
    const { trigger } = open();
    expect(dialog()).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('outside pointer-down dismisses; inside clicks do not', () => {
    open();
    fireEvent.mouseDown(dialog()!);
    expect(dialog()).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(dialog()).toBeNull();
  });

  it('Settings row is always present, invokes the callback, and closes', () => {
    const { onOpenSettings } = open();
    const settings = [...dialog()!.querySelectorAll('button')].find(b => b.textContent?.includes('Settings'))!;
    fireEvent.click(settings);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it('Appearance subpanel: three-way radiogroup, visible active state, persisted explicit choice', () => {
    open();
    fireEvent.click([...dialog()!.querySelectorAll('button')].find(b => b.textContent?.includes('Appearance'))!);
    const radios = [...dialog()!.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map(r => r.textContent?.replace(/Follow.*|Always.*/, ''))).toEqual(['System', 'Light', 'Dark']);
    expect(radios[0]!.getAttribute('aria-checked')).toBe('true'); // System default
    fireEvent.click(radios[1]!); // Light
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('wakichat:theme')).toBe('light');
    expect(radios[1]!.getAttribute('aria-checked')).toBe('true'); // visible active state
    fireEvent.click(radios[0]!); // back to System — itself an explicit action
    expect(localStorage.getItem('wakichat:theme')).toBe('system');
  });

  it('subpanel focuses Back on entry; Back returns to the main panel showing the new value', () => {
    open();
    fireEvent.click([...dialog()!.querySelectorAll('button')].find(b => b.textContent?.includes('Reading scale'))!);
    const back = [...dialog()!.querySelectorAll('button')].find(b => b.textContent?.includes('Reading scale'))!;
    expect(document.activeElement).toBe(back);
    fireEvent.click([...dialog()!.querySelectorAll<HTMLButtonElement>('[role="radio"]')][1]!); // Large
    expect(document.documentElement.dataset.readingScale).toBe('large');
    expect(localStorage.getItem('wakichat:reading-scale')).toBe('large');
    fireEvent.click(back);
    expect(dialog()!.querySelector('[role="radiogroup"]')).toBeNull();
    expect(dialog()!.textContent).toContain('Large'); // compact row reflects the choice
  });

  it('System setting follows the device LIVE via watchSystemTheme; explicit overrides do not', () => {
    let listener: (() => void) | null = null;
    const mq = {
      matches: false,
      addEventListener: (_: string, fn: () => void) => { listener = fn; },
      removeEventListener: () => { listener = null; },
    };
    (window as unknown as { matchMedia: () => typeof mq }).matchMedia = () => mq;
    const stop = watchSystemTheme();

    localStorage.setItem('wakichat:theme', 'system');
    mq.matches = true; // device flips to light
    listener!();
    expect(document.documentElement.dataset.theme).toBe('light');
    mq.matches = false; // device flips back
    listener!();
    expect(document.documentElement.dataset.theme).toBe('dark');

    localStorage.setItem('wakichat:theme', 'light'); // explicit override
    listener!();
    expect(document.documentElement.dataset.theme).toBe('dark'); // untouched by the device
    stop();
    expect(listener).toBeNull();
  });
});
