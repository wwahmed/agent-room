export interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGIN: string;
}

function cors(env: Env, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    ...extra,
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(env) });

    const { pathname } = new URL(req.url);
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: cors(env) });
    }

    if (pathname === '/api/draft' || pathname === '/api/minutes') {
      const { handleAI } = await import('./handlers.js');
      return handleAI(req, env, pathname, cors);
    }

    return new Response('Not found', { status: 404, headers: cors(env) });
  },
};
