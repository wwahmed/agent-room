import { describe, expect, it } from 'vitest';
import { answerRoomQuestion, createRoomQuestion, QuestionValidationError, requireQuestionAgent } from './questions.js';

const base = {
  id: 'Q-1',
  prompt: 'Which release path should we use?',
  mode: 'single',
  options: ['Ship now', 'Wait for QA'],
  createdBy: 'Codex',
  now: 100,
};

describe('structured room questions', () => {
  it('normalizes selectable options into stable ids', () => {
    const question = createRoomQuestion(base);
    expect(question.options).toEqual([
      { id: 'option-1', label: 'Ship now' },
      { id: 'option-2', label: 'Wait for QA' },
    ]);
    expect(question.answer).toBeUndefined();
  });

  it('records single, multiple, and text answers', () => {
    const single = createRoomQuestion(base);
    expect(answerRoomQuestion(single, 'option-2', 'Waqas', 200).answer?.value).toBe('option-2');

    const multiple = createRoomQuestion({ ...base, id: 'Q-2', mode: 'multiple', options: ['A', 'B', 'C'] });
    expect(answerRoomQuestion(multiple, ['option-1', 'option-3', 'option-1'], 'Waqas', 201).answer?.value)
      .toEqual(['option-1', 'option-3']);

    const text = createRoomQuestion({ ...base, id: 'Q-3', mode: 'text', options: undefined });
    expect(answerRoomQuestion(text, 'Use the signed build.', 'Waqas', 202).answer?.value)
      .toBe('Use the signed build.');
  });

  it('rejects malformed and duplicate options', () => {
    expect(() => createRoomQuestion({ ...base, options: ['Only one'] })).toThrow(QuestionValidationError);
    expect(() => createRoomQuestion({ ...base, options: ['Same', 'same'] })).toThrow(/unique/);
    expect(() => createRoomQuestion({ ...base, mode: 'text', options: ['Not allowed'] })).toThrow(/cannot include options/);
  });

  it('rejects unknown, empty, and second answers', () => {
    const single = createRoomQuestion(base);
    expect(() => answerRoomQuestion(single, 'option-9', 'Waqas', 200)).toThrow(/option ids/);
    const text = createRoomQuestion({ ...base, mode: 'text', options: undefined });
    expect(() => answerRoomQuestion(text, '   ', 'Waqas', 200)).toThrow(/required/);
    const answered = answerRoomQuestion(single, 'option-1', 'Waqas', 200);
    expect(() => answerRoomQuestion(answered, 'option-2', 'Waqas', 201)).toThrow(/already/);
  });

  it('allows exactly one matching room agent and rejects humans, absences, and ambiguity', () => {
    const row = (name: string, client: 'web' | 'cc') => ({ name, client }) as never;
    expect(() => requireQuestionAgent([row('Codex', 'cc'), row('Waqas', 'web')], 'Codex')).not.toThrow();
    expect(() => requireQuestionAgent([row('Waqas', 'web')], 'Waqas')).toThrow(/not a participant/);
    expect(() => requireQuestionAgent([row('Codex', 'cc'), row('Codex', 'cc')], 'Codex')).toThrow(/ambiguous/);
  });
});
