function must(name: string): string {
  const val = (import.meta.env as Record<string, string | undefined>)[name];
  if (!val) throw new Error(`Missing env var: ${name}`);
  return val;
}

function optional(name: string): string | undefined {
  return (import.meta.env as Record<string, string | undefined>)[name];
}

export const ENV = {
  upstash: {
    // Self-host default: the KV proxy lives on the same origin that serves
    // this bundle (/kv on the apps/server host), so the same build works on
    // chat.wakilabs.dev, localhost, and any future hostname. An explicit
    // VITE_UPSTASH_REDIS_REST_URL still wins (hosted Upstash, split origins).
    url: optional('VITE_UPSTASH_REDIS_REST_URL') || `${window.location.origin}/kv`,
    // T-12: the browser no longer carries a data credential. The server
    // authenticates /kv via the validated Cloudflare Access identity (or
    // localhost trust); this placeholder only satisfies the client's
    // Authorization header shape.
    token: optional('VITE_UPSTASH_REDIS_REST_TOKEN') || 'access-session',
  },
};
