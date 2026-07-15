// T-30: pure participant-authentication policy, split out of index.ts so the
// F1/F2 decisions are unit-testable without spinning an HTTP server or Redis.
// index.ts computes the SHA-256 of any presented key and feeds these
// functions; they never touch IO.

export interface AuthRow {
  memberKeyHash?: string;
  authIdHash?: string;
}

export type SenderDecision =
  | { ok: true; via: 'auth-id' | 'member-key' | 'legacy-name' }
  | { ok: false; reason: 'wrong-auth-id' | 'need-key' | 'bad-key' | 'no-flag' | 'ambiguous' };

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
  verifiedAuthIdHash?: string,
): SenderDecision {
  // T-69: an authenticated web participant is a person, not a browser tab.
  // The memberKey is per-tab and rotates on rejoin, so using it as the primary
  // web identity made two signed-in devices invalidate each other forever.
  // Prefer the durable server-verified Access identity whenever the row has
  // one. If an authenticated account is presented but does not match, fail
  // closed even if it somehow obtained another tab's member key.
  const authRows = rows.filter(r => r.authIdHash);
  if (verifiedAuthIdHash && authRows.length > 0) {
    if (authRows.some(r => r.authIdHash === verifiedAuthIdHash)) return { ok: true, via: 'auth-id' };
    return { ok: false, reason: 'wrong-auth-id' };
  }
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
