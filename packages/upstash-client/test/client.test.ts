import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient, NetworkError, RateLimitError } from '../src/index.js';

const ENV = { url: 'https://example.upstash.io', token: 'test-token' };

describe('createClient', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('sends a POST to / with Authorization header and command body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: 'hello' })));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient(ENV);
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
    const client = createClient(ENV);
    await expect(client.command(['GET', 'x'])).rejects.toBeInstanceOf(NetworkError);
  });

  it('throws RateLimitError on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
    const client = createClient(ENV);
    await expect(client.command(['GET', 'x'])).rejects.toBeInstanceOf(RateLimitError);
  });
});
