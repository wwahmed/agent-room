// T-36: pure, host-authorized alias-migration policy for the task board.
//
// Rewrites task owner/verifier bindings from a DEFUNCT participant alias to a
// current, keyed participant when an identity is renamed (T-25). It never
// touches historical message attribution — only board bindings — and never
// spoofs the old alias. The server wraps this with host-credential enforcement
// (requireHost) and a keyed-target check; this module owns the atomic,
// fail-closed board transform so it can be unit-tested in isolation.

export interface MigratableTask {
  id: string;
  owner?: string;
  ownerClient?: 'web' | 'cc';
  verifier?: string;
  verifierClient?: 'web' | 'cc';
}

export interface AliasMigration {
  from: string;
  to: string;
  toClient: 'web' | 'cc';
}

export class AliasMigrationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = code;
  }
}

/**
 * Validate the migration against the CURRENT board and return the list of
 * bindings that would change (e.g. ["T-30.owner", "T-30.verifier"]). Throws
 * (fail-closed) on bad input or any owner==verifier collision the remap would
 * create — WITHOUT mutating anything, so callers can check before applying.
 */
export function planAliasMigration(tasks: MigratableTask[], m: AliasMigration): string[] {
  const from = (m.from || '').trim();
  const to = (m.to || '').trim();
  if (!from || !to) throw new AliasMigrationError('BadRequestError', 'from and to are required');
  if (from === to) throw new AliasMigrationError('BadRequestError', 'from and to must differ');

  const migrated: string[] = [];
  for (const t of tasks) {
    const newOwner = t.owner === from ? to : t.owner;
    const newVerifier = t.verifier === from ? to : t.verifier;
    if (t.owner === from) migrated.push(`${t.id}.owner`);
    if (t.verifier === from) migrated.push(`${t.id}.verifier`);
    // A task must never end owner==verifier (that is the self-verification
    // conflict the board already forbids at create time).
    if (newOwner && newVerifier && newOwner === newVerifier) {
      throw new AliasMigrationError(
        'CollisionError',
        `reassign would make owner==verifier on ${t.id} (@${to}); resolve that binding first`,
      );
    }
  }
  return migrated;
}

/**
 * Apply the migration in place. Validates first (planAliasMigration throws on
 * any problem) so the mutation is all-or-nothing: if it throws, no task was
 * changed. Returns the list of rewritten bindings. Idempotent: a second run
 * with the same (now-absent) `from` matches nothing and returns [].
 */
export function applyAliasMigration(tasks: MigratableTask[], m: AliasMigration): string[] {
  const migrated = planAliasMigration(tasks, m); // throws → caller aborts, nothing mutated
  const from = m.from.trim();
  const to = m.to.trim();
  for (const t of tasks) {
    if (t.owner === from) {
      t.owner = to;
      t.ownerClient = m.toClient;
    }
    if (t.verifier === from) {
      t.verifier = to;
      t.verifierClient = m.toClient;
    }
  }
  return migrated;
}
