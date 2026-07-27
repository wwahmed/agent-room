// T-10: the "Get help" room action. Any participant can page the platform
// admin from any room; the page lands as an @mention in the admin HQ room,
// where the admin agent keeps a standing listen loop — so a tap in one room
// reaches an agent listening in another within one listen cycle. Pure
// composers live here so the wording (and the @mention that makes the page
// actually fire) is unit-testable without booting the server.

/** Where pages land. The admin agent must keep a listen loop in this room. */
export const ADMIN_HQ_ROOM = process.env.ADMIN_HQ_ROOM || 'hail-cow-dart';
/** Who gets @mentioned. Must match the admin agent's display name exactly —
 *  the mention grammar is what turns a message into a page. */
export const ADMIN_AGENT_NAME = process.env.ADMIN_AGENT_NAME || 'ClaudeAdmin';

export interface HelpPageInput {
  admin: string;
  requester: string;
  code: string;
  topic: string;
  origin: string;
  note?: string;
}

/** The message posted INTO the HQ room — leads with the @mention so the
 *  admin's listen loop flags it as a direct address. */
export function adminHelpPage(i: HelpPageInput): string {
  const note = i.note?.trim() ? ` — "${i.note.trim()}"` : '';
  return (
    `[HELP] @${i.admin} — ${i.requester} needs help in room ${i.code} ("${i.topic}")${note}. ` +
    `Join: ${i.origin}/j/${i.code}`
  );
}

/** The confirmation line posted back into the SOURCE room, so the requester
 *  knows the page went out without watching the HQ room. */
export function helpConfirmation(admin: string, requester: string): string {
  return `${requester} requested help — ${admin} has been paged in the admin room and will join shortly.`;
}
