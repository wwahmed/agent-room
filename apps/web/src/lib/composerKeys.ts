export type ComposerEnterAction = 'send' | 'newline' | 'ignore';

export interface ComposerEnterInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  mentionPickerOpen?: boolean;
  /** T-22: phone-width viewport — the touch keyboard's Enter is a NEWLINE
   *  there (the Send button is the send affordance), never a surprise send. */
  isPhone?: boolean;
}

/**
 * Resolve the room composer's Enter behavior without depending on React.
 * The mention picker gets first refusal, and composition Enter must never
 * submit an unfinished IME candidate.
 */
export function composerEnterAction(input: ComposerEnterInput): ComposerEnterAction {
  if (input.key !== 'Enter' || input.isComposing || input.mentionPickerOpen) return 'ignore';
  // T-22 (host): on the phone, Enter always inserts a newline — accidental
  // sends from the touch keyboard's return key were shipping half-written
  // messages, and touch has a dedicated Send button. Cmd/Ctrl+Enter (external
  // keyboard on a phone-width window) still sends deliberately.
  if (input.isPhone) {
    return input.ctrlKey || input.metaKey ? 'send' : 'newline';
  }
  if (input.shiftKey || input.ctrlKey || input.altKey) return 'newline';
  // Plain Enter sends. Keep Cmd+Enter equivalent to plain Enter for people
  // carrying the previous shortcut in muscle memory.
  return 'send';
}
