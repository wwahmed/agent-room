import { describe, it, expect } from 'vitest';
import { agentInvitePrompt } from './invite.js';

// T-07: the invite prompt is a contract, not prose — an external harness
// session pasted this verbatim must join correctly on the first try and
// know how to keep itself alive. Pin every load-bearing element.

describe('agentInvitePrompt', () => {
  const p = agentInvitePrompt('hail-cow-dart', 'https://chat.wakilabs.dev/j/hail-cow-dart', 'Chat Admin 2.0');

  it('carries the room code, join URL, and topic', () => {
    expect(p).toContain('hail-cow-dart');
    expect(p).toContain('https://chat.wakilabs.dev/j/hail-cow-dart');
    expect(p).toContain('"Chat Admin 2.0"');
  });

  it('demands an immediate room_join with the full identity fields', () => {
    expect(p).toContain('room_join');
    expect(p).toContain('NOW (no confirmation');
    for (const field of ['"name"', '"role"', '"model"', '"account"', '"capabilities"']) {
      expect(p).toContain(field);
    }
    // The account label warning travels WITH the field, not as tribal knowledge.
    expect(p).toContain('NEVER a secret');
    // Viewer mode is offered but explicitly opt-in.
    expect(p).toContain('"viewer": true ONLY if');
  });

  it('carries the listen-loop contract and the T-06 self-heal rule', () => {
    expect(p).toContain('room_listen with the returned cursor');
    expect(p).toContain('rejoin_required');
    expect(p).toContain('call room_join again at once with the SAME name');
  });

  it('omits the topic line when no topic is given', () => {
    const bare = agentInvitePrompt('abc-def-ghj', 'https://x/j/abc-def-ghj');
    expect(bare).not.toContain('topic is');
    expect(bare).toContain('abc-def-ghj');
  });
});
