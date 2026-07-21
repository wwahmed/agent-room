export type ComposerEnterAction = 'send' | 'newline' | 'ignore';

export interface ComposerEnterInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  mentionPickerOpen?: boolean;
}

/**
 * Resolve the room composer's Enter behavior without depending on React.
 * The mention picker gets first refusal, and composition Enter must never
 * submit an unfinished IME candidate.
 */
export function composerEnterAction(input: ComposerEnterInput): ComposerEnterAction {
  if (input.key !== 'Enter' || input.isComposing || input.mentionPickerOpen) return 'ignore';
  if (input.shiftKey || input.ctrlKey || input.altKey) return 'newline';
  // Plain Enter sends. Keep Cmd+Enter equivalent to plain Enter for people
  // carrying the previous shortcut in muscle memory.
  return 'send';
}
