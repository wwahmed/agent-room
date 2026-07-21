import type {
  RoomQuestion,
  RoomQuestionAnswer,
  RoomQuestionMode,
  RoomQuestionOption,
  Participant,
} from '@agent-room/shared';

export const MAX_QUESTION_PROMPT = 500;
export const MAX_QUESTION_CONTEXT = 2_000;
export const MAX_QUESTION_OPTIONS = 12;
export const MAX_QUESTION_OPTION_LABEL = 200;
export const MAX_QUESTION_TEXT_ANSWER = 5_000;

export class QuestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

export function requireQuestionAgent(participants: Participant[], name: string): void {
  const matches = participants.filter(participant => participant.client === 'cc' && participant.name === name);
  if (matches.length !== 1) {
    const error = new Error(
      matches.length === 0
        ? `Agent "${name || '(missing)'}" is not a participant in this room.`
        : `Agent "${name}" is ambiguous in this room.`,
    );
    error.name = 'MemberAuthError';
    throw error;
  }
}

function requiredText(value: unknown, field: string, max: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new QuestionValidationError(`${field} is required`);
  if (text.length > max) throw new QuestionValidationError(`${field} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredText(value, field, max);
}

function questionMode(value: unknown): RoomQuestionMode {
  if (value === 'single' || value === 'multiple' || value === 'text') return value;
  throw new QuestionValidationError('mode must be "single", "multiple", or "text"');
}

function questionOptions(value: unknown, mode: RoomQuestionMode): RoomQuestionOption[] | undefined {
  if (mode === 'text') {
    if (Array.isArray(value) && value.length > 0) {
      throw new QuestionValidationError('text questions cannot include options');
    }
    return undefined;
  }
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_QUESTION_OPTIONS) {
    throw new QuestionValidationError(`${mode} questions require 2-${MAX_QUESTION_OPTIONS} options`);
  }
  const labels = value.map((entry, index) => {
    const raw = typeof entry === 'string'
      ? entry
      : entry && typeof entry === 'object'
        ? (entry as { label?: unknown }).label
        : undefined;
    return requiredText(raw, `options[${index}]`, MAX_QUESTION_OPTION_LABEL);
  });
  if (new Set(labels.map(label => label.toLocaleLowerCase())).size !== labels.length) {
    throw new QuestionValidationError('question options must be unique');
  }
  return labels.map((label, index) => ({ id: `option-${index + 1}`, label }));
}

export function createRoomQuestion(input: {
  id: string;
  prompt: unknown;
  context?: unknown;
  mode: unknown;
  options?: unknown;
  createdBy: string;
  now: number;
}): RoomQuestion {
  const mode = questionMode(input.mode);
  const context = optionalText(input.context, 'context', MAX_QUESTION_CONTEXT);
  const options = questionOptions(input.options, mode);
  return {
    id: input.id,
    prompt: requiredText(input.prompt, 'prompt', MAX_QUESTION_PROMPT),
    ...(context ? { context } : {}),
    mode,
    ...(options ? { options } : {}),
    createdBy: requiredText(input.createdBy, 'createdBy', 200),
    createdByClient: 'cc',
    createdAt: input.now,
  };
}

export function answerRoomQuestion(
  question: RoomQuestion,
  rawValue: unknown,
  answeredBy: string,
  now: number,
): RoomQuestion {
  if (question.answer) throw new QuestionValidationError('question has already been answered');
  let value: RoomQuestionAnswer['value'];
  if (question.mode === 'text') {
    value = requiredText(rawValue, 'answer', MAX_QUESTION_TEXT_ANSWER);
  } else {
    const optionIds = new Set((question.options ?? []).map(option => option.id));
    if (question.mode === 'single') {
      if (typeof rawValue !== 'string' || !optionIds.has(rawValue)) {
        throw new QuestionValidationError('answer must be one of the question option ids');
      }
      value = rawValue;
    } else {
      if (!Array.isArray(rawValue) || rawValue.length === 0 || rawValue.some(item => typeof item !== 'string')) {
        throw new QuestionValidationError('answer must include at least one question option id');
      }
      const selected = [...new Set(rawValue as string[])];
      if (selected.some(id => !optionIds.has(id))) {
        throw new QuestionValidationError('answer contains an unknown question option id');
      }
      value = selected;
    }
  }
  return {
    ...question,
    answer: {
      value,
      answeredAt: now,
      answeredBy: requiredText(answeredBy, 'answeredBy', 200),
    },
  };
}
