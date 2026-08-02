import type { Participant } from '@agent-room/shared';

export function validateJoinParticipant(value: unknown): asserts value is Participant {
  if (!value || typeof value !== 'object') {
    const err = new Error('participant is required.');
    err.name = 'BadRequestError';
    throw err;
  }
  const row = value as Partial<Participant>;
  if (typeof row.name !== 'string' || !row.name.trim()) {
    const err = new Error('participant.name is required.');
    err.name = 'BadRequestError';
    throw err;
  }
  if (row.client !== 'web' && row.client !== 'cc') {
    const err = new Error('participant.client must be "web" or "cc".');
    err.name = 'BadRequestError';
    throw err;
  }
}
