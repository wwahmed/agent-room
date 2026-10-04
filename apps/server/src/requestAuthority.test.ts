import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_AUTHENTICATED_OWNER,
  type Message,
  type Participant,
} from '@agent-room/shared';
import { stampRequestAuthority } from './requestAuthority.js';

const email = 'owner@example.com';
const owner = {
  name: 'Waqas', role: 'Facilitator', client: 'web', color: '#000', initials: 'WA',
  joinedAt: 1, lastSeenAt: 1,
  authIdHash: createHash('sha256').update(email).digest('hex'),
} as Participant;
const message = {
  id: 1, type: 'msg', name: 'Waqas', role: 'Facilitator', client: 'web',
  color: '#000', initials: 'WA', time: 1, text: 'Deploy this release.',
  metadata: { dictated: true },
} as Message;

describe('server-stamped request authority', () => {
  it('marks an actionable send from the Access-authenticated room owner', () => {
    const out = stampRequestAuthority(message, {
      verifiedAccessEmail: email,
      senderRow: owner,
      roomCreatedBy: 'Waqas',
      actionable: true,
    });
    expect(out.metadata?.requestAuthority).toBe(ACCESS_AUTHENTICATED_OWNER);
    expect(out.metadata?.dictated).toBe(true);
  });

  it('strips forged authority from code-only, agent, guest, and status sends', () => {
    const forged = {
      ...message,
      metadata: { requestAuthority: ACCESS_AUTHENTICATED_OWNER },
    };
    const cases = [
      { verifiedAccessEmail: undefined, senderRow: owner, roomCreatedBy: 'Waqas', actionable: true },
      { verifiedAccessEmail: email, senderRow: { ...owner, client: 'cc' as const }, roomCreatedBy: 'Waqas', actionable: true },
      { verifiedAccessEmail: email, senderRow: owner, roomCreatedBy: 'Someone Else', actionable: true },
      { verifiedAccessEmail: email, senderRow: owner, roomCreatedBy: 'Waqas', actionable: false },
      { verifiedAccessEmail: 'other@example.com', senderRow: owner, roomCreatedBy: 'Waqas', actionable: true },
    ];
    for (const input of cases) {
      expect(stampRequestAuthority(forged, input).metadata?.requestAuthority).toBeUndefined();
    }
  });
});
