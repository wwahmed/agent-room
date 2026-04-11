import type { Message } from '@agent-room/shared';
import { ENV } from '../env.js';

async function call(path: '/api/draft' | '/api/minutes', payload: unknown): Promise<string> {
  if (!ENV.workerUrl) throw new Error('VITE_WORKER_URL not configured');
  const resp = await fetch(`${ENV.workerUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (resp.status === 429) throw new Error('AI temporarily unavailable — please wait');
  if (!resp.ok) throw new Error(`AI error: ${resp.status}`);
  const { text } = (await resp.json()) as { text: string };
  return text;
}

export function draftReply(input: {
  topic: string;
  userName: string;
  userRole: string;
  history: Message[];
}): Promise<string> {
  return call('/api/draft', {
    topic: input.topic,
    userName: input.userName,
    userRole: input.userRole,
    history: input.history.slice(-20).map(m => ({ name: m.name, text: m.text })),
  });
}

export function generateMinutes(input: { topic: string; history: Message[] }): Promise<string> {
  return call('/api/minutes', {
    topic: input.topic,
    history: input.history.map(m => ({ name: m.name, text: m.text })),
  });
}
