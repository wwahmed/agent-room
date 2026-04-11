import type { Env } from './index.js';

type CorsFn = (env: Env, extra?: Record<string, string>) => Record<string, string>;

const MODEL = 'claude-sonnet-4-6';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

const DRAFT_SYSTEM = (name: string, role: string) =>
  `You are ${name}'s AI assistant. ${name}'s role is ${role || 'participant'}. Based on the meeting discussion so far, suggest a single short message ${name} could send next. 2-3 sentences, first person, stay on topic. Output only the message text.`;

const MINUTES_SYSTEM = `You are a meeting minutes writer. Summarize the discussion in markdown: topic, participants, key points, decisions, action items. Concise and professional. English.`;

export async function handleAI(
  req: Request,
  env: Env,
  path: string,
  cors: CorsFn
): Promise<Response> {
  const { checkRate } = await import('./rateLimit.js');
  if (!(await checkRate(req))) {
    return new Response('Rate limited', { status: 429, headers: cors(env) });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400, headers: cors(env) });
  }
  const payload = body as {
    topic?: string;
    userName?: string;
    userRole?: string;
    history?: Array<{ name: string; text: string }>;
  };

  const historyText = (payload.history ?? []).map(m => `${m.name}: ${m.text}`).join('\n');
  const isDraft = path === '/api/draft';
  const system = isDraft
    ? DRAFT_SYSTEM(payload.userName ?? 'The user', payload.userRole ?? '')
    : MINUTES_SYSTEM;
  const user = isDraft
    ? `Meeting topic: ${payload.topic ?? ''}\n\nDiscussion so far:\n${historyText}\n\nWhat should I say next?`
    : `Topic: ${payload.topic ?? ''}\n\nTranscript:\n${historyText}\n\nWrite the meeting minutes.`;

  const anthropicResp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: isDraft ? 500 : 1200,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!anthropicResp.ok) {
    const txt = await anthropicResp.text();
    return new Response(`Anthropic error ${anthropicResp.status}: ${txt}`, {
      status: 502,
      headers: cors(env, { 'Content-Type': 'text/plain' }),
    });
  }

  const data = (await anthropicResp.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const text = data.content.map(c => c.text ?? '').join('');

  return new Response(JSON.stringify({ text }), {
    status: 200,
    headers: cors(env, { 'Content-Type': 'application/json' }),
  });
}
