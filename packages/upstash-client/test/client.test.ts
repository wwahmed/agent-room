import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, UpstashError } from '../src/index.js';

// T-71 rev19 review item 4/5: the REAL transport client against HTTP 200
// bodies that carry Redis-level errors — not a fake client that throws for
// itself.

const ENV = { url: 'https://fake.upstash.example', token: 'test-token' };

function stubFetch(body: unknown) {
  const mock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe('createClient transport error surfacing', () => {
  it('pipeline: an HTTP-200 item {error} throws with index and command name', async () => {
    stubFetch([{ result: 1 }, { error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }, { result: 'OK' }]);
    const client = createClient(ENV);
    await expect(client.pipeline([['RPUSH', 'k', 'v'], ['RPUSH', 'bad', 'v'], ['SET', 'm', '1']]))
      .rejects.toThrow(/pipeline\[1\] RPUSH: WRONGTYPE/);
  });

  it('pipeline: result-only items map through in order', async () => {
    stubFetch([{ result: 1 }, { result: 2 }]);
    const client = createClient(ENV);
    await expect(client.pipeline([['RPUSH', 'k', 'a'], ['RPUSH', 'k', 'b']])).resolves.toEqual([1, 2]);
  });

  it('command: an HTTP-200 body {error} throws instead of returning undefined', async () => {
    stubFetch({ error: 'ERR value is not an integer or out of range' });
    const client = createClient(ENV);
    await expect(client.command(['SET', 'marker', '1'])).rejects.toThrow(/SET: ERR value/);
    await expect(client.command(['SET', 'marker', '1'])).rejects.toBeInstanceOf(UpstashError);
  });

  it('command: a normal result still returns', async () => {
    stubFetch({ result: 'OK' });
    const client = createClient(ENV);
    await expect(client.command(['SET', 'k', 'v'])).resolves.toBe('OK');
  });
});
