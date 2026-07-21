import { describe, expect, it } from 'vitest';
import { isTheme, resolveTheme, resolveThemeSetting, nextTheme, themeColor, THEME_STORAGE_KEY } from './theme.js';

describe('theme resolution', () => {
  it('recognizes only valid theme strings', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('')).toBe(false);
    expect(isTheme('LIGHT')).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(undefined)).toBe(false);
  });

  it('lets an explicit stored choice win over the OS preference', () => {
    expect(resolveTheme('light', false)).toBe('light'); // stored light, OS dark
    expect(resolveTheme('dark', true)).toBe('dark'); // stored dark, OS light
  });

  it('follows the OS preference when there is no stored choice', () => {
    expect(resolveTheme(null, true)).toBe('light');
    expect(resolveTheme(null, false)).toBe('dark');
  });

  it('defaults to dark for a missing or garbage stored value', () => {
    expect(resolveTheme(null, false)).toBe('dark');
    expect(resolveTheme('purple', false)).toBe('dark');
    expect(resolveTheme('purple', true)).toBe('light'); // garbage → fall through to OS
  });

  it('toggles between the two themes', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
  });

  it('maps each theme to a browser-chrome color', () => {
    expect(themeColor('light')).toBe('#EBEDF1');
    expect(themeColor('dark')).toBe('#0B0F16');
  });

  it('uses a stable storage key', () => {
    expect(THEME_STORAGE_KEY).toBe('wakichat:theme');
  });

  // T-26/T-27: three-way setting. 'system' is the default for new users and
  // for junk; explicit light/dark stored choices survive as overrides.
  it('resolves the three-way setting with system as default', () => {
    expect(resolveThemeSetting(null)).toBe('system');
    expect(resolveThemeSetting('purple')).toBe('system');
    expect(resolveThemeSetting('system')).toBe('system');
    expect(resolveThemeSetting('light')).toBe('light');
    expect(resolveThemeSetting('dark')).toBe('dark');
  });
});
