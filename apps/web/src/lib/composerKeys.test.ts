import { describe, expect, it } from 'vitest';
import { composerEnterAction } from './composerKeys.js';

describe('composerEnterAction', () => {
  it('sends on plain Enter', () => {
    expect(composerEnterAction({ key: 'Enter' })).toBe('send');
  });

  it('inserts a newline on Shift+Enter or Ctrl+Enter', () => {
    expect(composerEnterAction({ key: 'Enter', shiftKey: true })).toBe('newline');
    expect(composerEnterAction({ key: 'Enter', ctrlKey: true })).toBe('newline');
  });

  it('keeps the former Cmd+Enter send shortcut working', () => {
    expect(composerEnterAction({ key: 'Enter', metaKey: true })).toBe('send');
  });

  it('does not send while an IME composition is being confirmed', () => {
    expect(composerEnterAction({ key: 'Enter', isComposing: true })).toBe('ignore');
  });

  it('leaves Enter to an open mention picker', () => {
    expect(composerEnterAction({ key: 'Enter', mentionPickerOpen: true })).toBe('ignore');
  });

  it('ignores unrelated keys', () => {
    expect(composerEnterAction({ key: 'Tab' })).toBe('ignore');
  });
});
