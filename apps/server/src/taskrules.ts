// Builder != verifier invariant, made robust to owner/verifier collisions.
//
// A task can be created with a designated verifier that differs from the owner
// (the create handler enforces that). But ownership can change AFTER creation:
// when a task is cross-assigned (built by A, verified by B) and A goes offline,
// another agent picks the work up and becomes the owner. If that new owner is
// the same agent the task named as its verifier, the assignment becomes
// impossible to satisfy — the owner is barred from self-verifying, and the
// "only the designated verifier may rule" guard then locks EVERY other agent
// out too. The task deadlocks in awaiting_review forever.
//
// The fix is to never honor an owner==verifier designation. The effective
// verifier is the designated one only while it differs from the owner;
// otherwise verification is open to any non-owner (exactly as an unassigned
// verifier already behaves). This only ever REMOVES a deadlock — the owner is
// still barred from ruling on their own task by a separate self-verify guard,
// so the invariant holds.

/**
 * The verifier that is actually allowed to rule, or undefined when the task has
 * no satisfiable designated verifier (unset, or equal to the owner).
 */
export function effectiveVerifier(owner?: string, verifier?: string): string | undefined {
  if (!verifier) return undefined;
  if (verifier === owner) return undefined;
  return verifier;
}

/** True when the designated verifier collides with the owner and must be dropped. */
export function verifierCollidesWithOwner(owner?: string, verifier?: string): boolean {
  return !!verifier && verifier === owner;
}
