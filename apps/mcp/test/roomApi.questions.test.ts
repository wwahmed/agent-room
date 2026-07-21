import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOwnerQuestion, createRoomApiClient, listOwnerQuestions } from '../src/roomApi.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('owner question room API', () => {
  it('creates and lists structured questions for an agent identity', async () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => body.action === 'questionCreate'
          ? { question: { id: 'Q-1', ...body } }
          : { questions: [{ id: 'Q-1' }] },
      } as Response;
    }));

    const client = createRoomApiClient();
    const created = await createOwnerQuestion(client, 'twig-ant-stem', 'Codex', {
      prompt: 'Pick a release path',
      context: 'QA is green.',
      mode: 'single',
      options: ['Ship', 'Wait'],
    });
    const listed = await listOwnerQuestions(client, 'twig-ant-stem', 'Codex');

    expect(created.id).toBe('Q-1');
    expect(listed).toHaveLength(1);
    expect(calls).toEqual([
      {
        action: 'questionCreate',
        code: 'twig-ant-stem',
        name: 'Codex',
        prompt: 'Pick a release path',
        context: 'QA is green.',
        mode: 'single',
        options: ['Ship', 'Wait'],
      },
      { action: 'questionList', code: 'twig-ant-stem', name: 'Codex' },
    ]);
  });
});
