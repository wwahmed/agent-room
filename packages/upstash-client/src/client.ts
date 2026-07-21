import { NetworkError, RateLimitError, UpstashError } from './errors.js';

export interface UpstashEnv {
  url: string;
  token: string;
}

export interface UpstashClient {
  command<T = unknown>(cmd: readonly (string | number)[]): Promise<T>;
  pipeline<T = unknown>(cmds: readonly (readonly (string | number)[])[]): Promise<T[]>;
}

export function createClient(env: UpstashEnv): UpstashClient {
  const base = env.url.replace(/\/$/, '');
  // We hammer this endpoint from polling loops with identical request
  // bodies (e.g. [GET counter, LLEN list] every 3 seconds). Browsers and
  // some CDNs honor Cache-Control on POST responses → identical body =
  // served from cache for the response TTL, even though new writes have
  // landed in Redis. Symptom Robin caught: polling logged `fresh: 0`
  // for ~30 seconds while messages had clearly been written, then
  // suddenly caught up when the cache expired. Forcing `no-store` on
  // every request short-circuits any layer that might be caching us.
  const headers = {
    'Authorization': `Bearer ${env.token}`,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
  };

  async function post(path: string, body: unknown): Promise<unknown> {
    let resp: Response;
    try {
      resp = await fetch(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        cache: 'no-store',
      });
    } catch (e) {
      throw new NetworkError(e);
    }
    if (resp.status === 429) throw new RateLimitError();
    if (!resp.ok) throw new UpstashError(`Upstash HTTP ${resp.status}`);
    return resp.clone().json();
  }

  return {
    async command<T>(cmd: readonly (string | number)[]): Promise<T> {
      const out = (await post('/', cmd)) as { result?: T; error?: string };
      // Same discipline as pipeline(): an HTTP-200 body can still carry a
      // Redis-level {error}; trusting status alone let a failed single
      // command pass as success.
      if (out && typeof out === 'object' && 'error' in out && out.error) {
        throw new UpstashError(`${String(cmd[0] ?? '?')}: ${out.error}`);
      }
      // Contract validation: an HTTP-200 body must carry a `result` key (null
      // counts) or a surfaced error. `{}` returning undefined let callers —
      // notably the merge-marker SET — treat silence as acknowledgement.
      if (!out || typeof out !== 'object' || !('result' in out)) {
        throw new UpstashError(`${String(cmd[0] ?? '?')}: malformed response (no result)`);
      }
      return out.result as T;
    },
    async pipeline<T>(cmds: readonly (readonly (string | number)[])[]): Promise<T[]> {
      const out = (await post('/pipeline', cmds)) as Array<{ result?: T; error?: string }>;
      // A pipeline response can carry a PER-COMMAND {error} while the HTTP
      // call succeeds. Swallowing those (mapping only .result) let a failed
      // write pass silently — surface the first item error as a real throw.
      for (let i = 0; i < out.length; i++) {
        const item = out[i];
        if (item && typeof item === 'object' && 'error' in item && item.error) {
          throw new UpstashError(`pipeline[${i}] ${String(cmds[i]?.[0] ?? '?')}: ${item.error}`);
        }
        if (!item || typeof item !== 'object' || !('result' in item)) {
          throw new UpstashError(`pipeline[${i}] ${String(cmds[i]?.[0] ?? '?')}: malformed response (no result)`);
        }
      }
      return out.map(x => x.result as T);
    },
  };
}
