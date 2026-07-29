import type { Message } from '@agent-room/shared';
import { describe, expect, it } from 'vitest';

import { messagesForLineage } from '../src/tools.js';

const makeMessage = (id: number, target?: string): Message => ({
  id, type: 'msg', name: 'Waqas', role: '', initials: 'WA', color: '#000',
  client: 'web', text: target ? 'Structured action request' : 'Ordinary message', time: id,
  ...(target ? { metadata: { viewAction: {
    actionId: 'draft', label: 'Draft', sourceMessageId: 1,
    sourceSender: 'MailAgent', sourceLineage: target, viewVersion: 1, nonce: 'n',
  } } } : {}),
} as Message);

describe('producer-only structured action delivery', () => {
  const mine = 'a'.repeat(32);
  const other = 'b'.repeat(32);
  const batch = [makeMessage(1), makeMessage(2, mine), makeMessage(3, other)];

  it('delivers a targeted request only to its exact producer lineage', () => {
    expect(messagesForLineage(batch, mine).map(m => m.id)).toEqual([1, 2]);
    expect(messagesForLineage(batch, other).map(m => m.id)).toEqual([1, 3]);
  });

  it('fails closed for a legacy listener with no lineage', () => {
    expect(messagesForLineage(batch).map(m => m.id)).toEqual([1]);
  });
});
