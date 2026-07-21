import type { RoomQuestion } from '@agent-room/shared';

export function questionAnswerLabels(question: RoomQuestion): string[] {
  if (!question.answer) return [];
  const values = Array.isArray(question.answer.value) ? question.answer.value : [question.answer.value];
  if (question.mode === 'text') return values;
  const labels = new Map((question.options ?? []).map(option => [option.id, option.label]));
  return values.map(value => labels.get(value) ?? value);
}

export function partitionQuestions(questions: RoomQuestion[]): {
  pending: RoomQuestion[];
  answered: RoomQuestion[];
} {
  return {
    pending: questions.filter(question => !question.answer),
    answered: questions.filter(question => Boolean(question.answer)),
  };
}
