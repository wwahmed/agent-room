// T-141: the discoverable slash-command palette data. Typing "/" at the start of
// the composer opens a menu of these; the parser (lib/briefCommand) still owns
// what each one DOES when sent. Kept as data + a pure filter so the menu and its
// keyboard behavior are unit-testable without the DOM.

export interface SlashCommand {
  /** Text inserted into the composer when completed. A trailing space means the
   *  command expects an argument the user keeps typing (e.g. a topic). */
  insert: string;
  /** How the command reads in the menu (may show an <arg> placeholder). */
  label: string;
  /** One-line description of what it does. */
  hint: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { insert: '/brief', label: '/brief', hint: 'Executive brief — decisions first, what changed, what is live' },
  { insert: '/brief-with-audio', label: '/brief-with-audio', hint: 'The brief, read aloud' },
  { insert: '/brief deep', label: '/brief deep', hint: 'A longer brief with more detail' },
  { insert: '/brief ', label: '/brief <topic>', hint: 'Brief scoped to one workstream' },
];

/** Commands to offer for the current composer text. Only a LEADING "/" opens the
 *  menu, so "and/or" or a URL mid-message never triggers it. Matches against both
 *  the inserted text and the human label so "/brief-w" and "/brief d" both narrow. */
export function filterSlashCommands(text: string): SlashCommand[] {
  if (!text.startsWith('/')) return [];
  // No spaces before an argument: once the user is typing a topic ("/brief pay"),
  // the menu should have closed — only match while still on the command token.
  const q = text.toLowerCase();
  const matches = SLASH_COMMANDS.filter(
    (c) => c.insert.toLowerCase().startsWith(q) || c.label.toLowerCase().startsWith(q),
  );
  // De-dupe identical labels while preserving order.
  const seen = new Set<string>();
  return matches.filter((c) => (seen.has(c.label) ? false : (seen.add(c.label), true)));
}
