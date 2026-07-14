import { describe, it, expect } from 'vitest';
import { statusForError } from './httpstatus.js';
import { AgentAnchorConflictError } from '@agent-room/upstash-client';

const named = (name: string): Error => Object.assign(new Error('x'), { name });

describe('statusForError', () => {
  // T-66: an anchor conflict is a REFUSAL, not a server fault. It was falling
  // through to 500, which reads as "we broke" instead of "we said no" — and a
  // 500 is the one status a caller is entitled to retry.
  it('maps AgentAnchorConflictError to 409, not 500', () => {
    expect(statusForError(new AgentAnchorConflictError('Builder'))).toBe(409);
    expect(statusForError(named('AgentAnchorConflictError'))).toBe(409);
  });

  it('still maps the auth failures to 403 and missing rooms to 404', () => {
    expect(statusForError(named('MemberAuthError'))).toBe(403);
    expect(statusForError(named('HostNameTakenError'))).toBe(403);
    expect(statusForError(named('RoomNotFoundError'))).toBe(404);
  });

  it('falls back to 500 only for genuinely unknown errors', () => {
    expect(statusForError(new Error('kaboom'))).toBe(500);
  });
});
