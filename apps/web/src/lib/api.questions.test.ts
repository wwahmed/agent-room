import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerOwnerQuestion, createClient, listOwnerQuestions } from './api.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('owner question API', () => {
  it('uses the private question actions and presents the stored host credential', async () => {
    const store = new Map([['room:twig-ant-stem:hostKey', 'HOST-KEY']]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    };
    (globalThis as { sessionStorage?: unknown }).sessionStorage = (globalThis as { localStorage: unknown }).localStorage;
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => body.action === 'questionList'
          ? { questions: [] }
          : { question: { id: body.id, answer: { value: body.value } } },
      } as Response;
    }));

    const client = createClient();
    await listOwnerQuestions(client, 'twig-ant-stem');
    await answerOwnerQuestion(client, 'twig-ant-stem', 'Q-1', ['option-1']);

    expect(calls).toEqual([
      { action: 'questionList', code: 'twig-ant-stem', hostKey: 'HOST-KEY' },
      { action: 'questionAnswer', code: 'twig-ant-stem', id: 'Q-1', value: ['option-1'], hostKey: 'HOST-KEY' },
    ]);
  });
});
