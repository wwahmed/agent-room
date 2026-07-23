// T-137: concise, human release notes shown in the "What's new" panel (opened
// from the account menu and linked from the update banner). Bundled with the
// app, so they ship WITH the code they describe. Newest first. Written in plain
// owner language — what changed for YOU, not task ids or commit hashes.

export interface ReleaseNote {
  /** ISO date of the release group, e.g. "2026-07-23". Also the "seen" key. */
  date: string;
  /** Short theme for the group. */
  title: string;
  /** One line per user-facing change, in plain language. */
  items: string[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    date: '2026-07-23',
    title: 'Faster catch-up',
    items: [
      'Opening a chat now lands you on your first unread message, so you read new messages top to bottom instead of starting at the bottom.',
      'Type /brief for a quick executive summary: what needs a decision from you, what changed since you last looked, and what just shipped.',
      'Add /brief-with-audio to hear the brief read aloud.',
      'Type “/” in the message box to see the command menu and pick a command without memorizing it.',
    ],
  },
  {
    date: '2026-07-22',
    title: 'Calmer, clearer dictation',
    items: [
      'Dictate and Send are separate buttons now. Start typing while dictating and it pauses automatically; tap to resume.',
      'Recording keeps the screen awake, and the repeated beeps during pauses are gone.',
      'The message box shows a clear “transcribing” state while it listens.',
    ],
  },
  {
    date: '2026-07-21',
    title: 'Reading and reliability',
    items: [
      'Your read position now syncs across your devices, so unread badges agree everywhere.',
      'Returning to a chat you had in the background no longer drops the newest messages.',
      'Long messages continue inline where you were reading instead of jumping you around.',
    ],
  },
];

/** The newest release date — used to decide whether to badge "What's new". */
export const LATEST_RELEASE_DATE = RELEASE_NOTES[0]?.date ?? '';

const SEEN_KEY = 'wakichat:notes-seen';

/** True when there is a release the user has not opened "What's new" for yet. */
export function hasUnseenReleaseNotes(): boolean {
  try {
    return (localStorage.getItem(SEEN_KEY) ?? '') !== LATEST_RELEASE_DATE;
  } catch {
    return false;
  }
}

/** Mark the latest release as seen (called when the panel opens). */
export function markReleaseNotesSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, LATEST_RELEASE_DATE);
  } catch {
    /* storage unavailable — the badge simply won't persist as dismissed */
  }
}

/** Format an ISO date as a short human label, e.g. "Jul 23, 2026". */
export function formatReleaseDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((n) => Number(n));
  if (!y || !m || !d) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}
