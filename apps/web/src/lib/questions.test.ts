import { describe, expect, it } from 'vitest';
import type { RoomQuestion } from '@agent-room/shared';
import { partitionQuestions, questionAnswerLabels } from './questions.js';

const question = (id: string, answer?: RoomQuestion['answer']): RoomQuestion => ({
  id,
  prompt: `Prompt ${id}`,
  mode: 'multiple',
  options: [{ id: 'option-1', label: 'Alpha' }, { id: 'option-2', label: 'Beta' }],
  createdBy: 'Codex',
  createdByClient: 'cc',
  createdAt: 1,
  answer,
});

describe('question presentation helpers', () => {
  it('partitions pending and answered items without reordering', () => {
    const rows = [question('Q-1'), question('Q-2', { value: ['option-2'], answeredAt: 2, answeredBy: 'Waqas' })];
    expect(partitionQuestions(rows).pending.map(row => row.id)).toEqual(['Q-1']);
    expect(partitionQuestions(rows).answered.map(row => row.id)).toEqual(['Q-2']);
  });

  it('maps selectable ids to owner-facing labels and preserves text answers', () => {
    expect(questionAnswerLabels(question('Q-1', { value: ['option-2', 'option-1'], answeredAt: 2, answeredBy: 'Waqas' })))
      .toEqual(['Beta', 'Alpha']);
    expect(questionAnswerLabels({ ...question('Q-3'), mode: 'text', options: undefined, answer: { value: 'Free form', answeredAt: 2, answeredBy: 'Waqas' } }))
      .toEqual(['Free form']);
  });
});
