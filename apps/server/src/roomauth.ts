// T-30: pure participant-authentication policy, split out of index.ts so the
// F1/F2 decisions are unit-testable without spinning an HTTP server or Redis.
// index.ts computes the SHA-256 of any presented key and feeds these
// functions; they never touch IO.

export interface AuthRow {
  memberKeyHash?: string;
}

export type SenderDecision =
  | { ok: true; via: 'member-key' | 'legacy-name' }
  | { ok: false; reason: 'need-key' | 'bad-key' | 'no-flag' | 'ambiguous' };

/**
 * Decide whether a caller may send/refresh presence AS the participant
 * row(s) it claims (already filtered to matching name+client).
 *
 *  - Empty `rows` is the caller's responsibility (there is nothing to
 *    authenticate against); this function assumes rows.length >= 1.
 *  - A row carrying a memberKeyHash REQUIRES the matching plaintext key
 *    (`presentedHash`). A display name alone never authenticates (F2/F3).
 *  - A keyless row (credential-unaware MCP 0.25.x) is allowed only via the
 *    flag-gated legacy path, and only when unambiguous; otherwise fail closed
 *    (F6/F7/F8).
 */
export function decideSenderAuth(
  rows: AuthRow[],
  presentedHash: string | undefined,
  allowLegacy: boolean,
): SenderDecision {
  const keyed = rows.filter(r => r.memberKeyHash);
  if (keyed.length > 0) {
    if (!presentedHash) return { ok: false, reason: 'need-key' };
    if (keyed.some(r => r.memberKeyHash === presentedHash)) return { ok: true, via: 'member-key' };
    return { ok: false, reason: 'bad-key' };
  }
  if (!allowLegacy) return { ok: false, reason: 'no-flag' };
  if (rows.length > 1) return { ok: false, reason: 'ambiguous' };
  return { ok: true, via: 'legacy-name' };
}
