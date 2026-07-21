import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, NetworkError, RateLimitError, UpstashError } from '../src/index.js';

// T-71 rev19 review item 4/5: the REAL transport client against HTTP 200
// bodies that carry Redis-level errors — not a fake client that throws for
// itself.

const ENV = { url: 'https://fake.upstash.example', token: 'test-token' };

// ---- Restored pre-rev20 transport contract tests (review: coverage must
// never be traded away) — original ENV url preserved per-test below. ----
const LEGACY_ENV = { url: 'https://example.upstash.io', token: 'test-token' };


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



describe('createClient', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('sends a POST to / with Authorization header and command body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: 'hello' })));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient(LEGACY_ENV);
    const result = await client.command(['GET', 'mykey']);

    expect(result).toBe('hello');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.upstash.io/');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as any).headers['Authorization']).toBe('Bearer test-token');
    const body = JSON.parse((init as any).body);
    expect(body).toEqual(['GET', 'mykey']);
  });

  it('throws NetworkError on fetch rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const client = createClient(LEGACY_ENV);
    await expect(client.command(['GET', 'x'])).rejects.toBeInstanceOf(NetworkError);
  });

  it('throws RateLimitError on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
    const client = createClient(LEGACY_ENV);
    await expect(client.command(['GET', 'x'])).rejects.toBeInstanceOf(RateLimitError);
  });

  it('pipeline POSTs to /pipeline and unpacks the result array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ result: 1 }, { result: 'OK' }]))
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient(LEGACY_ENV);
    const results = await client.pipeline([
      ['RPUSH', 'key', 'a'],
      ['LTRIM', 'key', -5, -1],
    ]);

    expect(results).toEqual([1, 'OK']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.upstash.io/pipeline');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as any).body);
    expect(body).toEqual([
      ['RPUSH', 'key', 'a'],
      ['LTRIM', 'key', -5, -1],
    ]);
  });
});

describe('createClient contract validation (rev20 follow-up)', () => {
  it('command: HTTP 200 with {} throws malformed instead of returning undefined', async () => {
    stubFetch({});
    const client = createClient(ENV);
    await expect(client.command(['SET', 'marker', '1'])).rejects.toThrow(/SET: malformed response/);
  });
  it('pipeline: an item {} throws malformed with its index and command', async () => {
    stubFetch([{ result: 1 }, {}]);
    const client = createClient(ENV);
    await expect(client.pipeline([['RPUSH', 'k', 'v'], ['SET', 'm', '1']])).rejects.toThrow(/pipeline\[1\] SET: malformed/);
  });
  it('command: {result: null} is a VALID nil, not malformed', async () => {
    stubFetch({ result: null });
    const client = createClient(ENV);
    await expect(client.command(['GET', 'missing'])).resolves.toBeNull();
  });
});
