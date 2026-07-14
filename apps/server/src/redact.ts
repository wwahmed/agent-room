// T-66: strip server-only identity material from anything leaving the process.
//
// Rooms are handed to every member, so any secret-derived field on a room or a
// participant row is effectively public to the room. Three were shipping:
//
//   - authIdHash  = sha256(<Access email>). The dangerous one. Emails are
//     LOW-ENTROPY — a member (or anyone who reaches the API) can hash a
//     candidate list and confirm exactly which human is in a room. That is
//     deanonymization of a real person, not a theoretical hash leak.
//   - memberKeyHash / hostKeyHash = sha256(<high-entropy random secret>). Not
//     invertible, but they are the verifier for the auth check — they have no
//     business outside the server, and publishing a verifier is how an offline
//     attack starts.
//
// These are used ONLY server-side (findReclaimRow, the send/host auth checks),
// so redacting them costs nothing. Applied at the single response choke point
// rather than per-action, so a new action cannot silently reintroduce the leak.
// agentIdHash (T-66) is sha256 of an agent's durable anchor. It never rotates,
// so leaking the verifier is strictly worse than leaking memberKeyHash — an
// offline hit against it would be good forever. Redacted with the rest.
const SECRET_PARTICIPANT_FIELDS = ['memberKeyHash', 'authIdHash', 'agentIdHash'] as const;

export function redactParticipant<T extends Record<string, unknown>>(p: T): T {
  const out = { ...p };
  for (const f of SECRET_PARTICIPANT_FIELDS) delete out[f];
  return out;
}

export function redactRoomPayload<T>(result: T): T {
  if (!result || typeof result !== 'object') return result;
  const out = { ...(result as Record<string, unknown>) };

  const room = out.room as { participants?: Record<string, unknown>[] } | undefined;
  if (room && typeof room === 'object') {
    const r = { ...(room as Record<string, unknown>) };
    delete r.hostKeyHash;
    if (Array.isArray(r.participants)) r.participants = r.participants.map(redactParticipant);
    out.room = r;
  }

  // The join path also returns the caller's own row alongside the room.
  const participant = out.participant as Record<string, unknown> | undefined;
  if (participant && typeof participant === 'object') out.participant = redactParticipant(participant);

  // NOTE: top-level `memberKey` / `hostKey` are the plaintext secrets we are
  // deliberately issuing to their owner exactly once. They must pass through.
  return out as T;
}
