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

  // T-22 (host): on the phone, the touch keyboard's Enter is a NEWLINE —
  // the Send button is the send affordance; accidental sends shipped
  // half-written messages.
  it('on the phone, plain Enter inserts a newline, never sends', () => {
    expect(composerEnterAction({ key: 'Enter', isPhone: true })).toBe('newline');
    expect(composerEnterAction({ key: 'Enter', isPhone: true, shiftKey: true })).toBe('newline');
  });

  it('an external keyboard on a phone-width window still sends with Cmd/Ctrl+Enter', () => {
    expect(composerEnterAction({ key: 'Enter', isPhone: true, metaKey: true })).toBe('send');
    expect(composerEnterAction({ key: 'Enter', isPhone: true, ctrlKey: true })).toBe('send');
  });

  it('phone Enter still respects IME composition and the mention picker', () => {
    expect(composerEnterAction({ key: 'Enter', isPhone: true, isComposing: true })).toBe('ignore');
    expect(composerEnterAction({ key: 'Enter', isPhone: true, mentionPickerOpen: true })).toBe('ignore');
  });
});
