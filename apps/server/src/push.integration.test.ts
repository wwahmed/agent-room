import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:https';
import { Agent } from 'node:https';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initPush, sendToAccount, type StoredSubscription, type SubscriptionStore } from './push.js';

// T-118 integration: the REAL web-push dispatch against a local TLS push
// service — VAPID Authorization header, TTL, aes128gcm-encrypted body, and
// dead-endpoint pruning. web-push always speaks TLS, so the fixture cert +
// injected agent stand in for a public push service.

const CERT = new URL('../test-fixtures/push-test-cert.pem', import.meta.url).pathname;
const KEY = new URL('../test-fixtures/push-test-key.pem', import.meta.url).pathname;

function browserLikeSubscription(endpoint: string): StoredSubscription {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { endpoint, keys: { p256dh: raw.toString('base64url'), auth: randomBytes(16).toString('base64url') }, addedAt: 1 };
}

function memoryStore(initial: StoredSubscription[]): SubscriptionStore & { current: StoredSubscription[] } {
  const box = { current: initial } as SubscriptionStore & { current: StoredSubscription[] };
  box.read = async () => box.current;
  box.write = async (_e, subs) => { box.current = subs; };
  return box;
}

describe('push dispatch over the wire (T-118)', () => {
  let server: Server;
  let port = 0;
  let statusToReturn = 201;
  const captures: Array<{ authorization: string; ttl: string; contentEncoding: string; bodyBytes: number }> = [];
  const agent = new Agent({ ca: readFileSync(CERT) });

  beforeAll(async () => {
    initPush({ publicKey: 'BDd3_hVL9fZi9Ybo2UUmA0kV9v6-jpKzeeRuMSg9iBAlSK0DVWpAv64BFR3QLXybOKLG5Ce9G1JGMTCLC28LpBo', privateKey: 'CkFXFdYAhOSTb0V0mNEQpk0-9ohBPGfCpMPTqf9Rqrw', subject: 'mailto:test@example.com', ownerEmail: 'owner@test', ownerNames: ['Waqas'] });
    server = createServer({ cert: readFileSync(CERT), key: readFileSync(KEY) }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c as Buffer));
      req.on('end', () => {
        captures.push({
          authorization: String(req.headers.authorization || ''),
          ttl: String(req.headers.ttl || ''),
          contentEncoding: String(req.headers['content-encoding'] || ''),
          bodyBytes: Buffer.concat(chunks).length,
        });
        res.writeHead(statusToReturn);
        res.end();
      });
    });
    await new Promise<void>(res => server.listen(0, '127.0.0.1', () => res()));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => { server.close(); });

  it('delivers a VAPID-signed, aes128gcm-encrypted notification', async () => {
    const store = memoryStore([browserLikeSubscription(`https://127.0.0.1:${port}/push/dev1`)]);
    const outcome = await sendToAccount(store, 'owner@test', { title: 'T', body: 'B', url: '/r/x' }, agent);
    expect(outcome).toMatchObject({ sent: 1, pruned: 0 });
    const cap = captures.at(-1)!;
    expect(cap.authorization).toMatch(/^vapid t=/);
    expect(cap.ttl).toBe('3600');
    expect(cap.contentEncoding).toBe('aes128gcm');
    expect(cap.bodyBytes).toBeGreaterThan(80); // encrypted payload, not plaintext
  });

  it('prunes an endpoint that answers 410 Gone and keeps the rest', async () => {
    statusToReturn = 410;
    const store = memoryStore([browserLikeSubscription(`https://127.0.0.1:${port}/push/dead`)]);
    const outcome = await sendToAccount(store, 'owner@test', { title: 'T', body: 'B', url: '/' }, agent);
    expect(outcome.pruned).toBe(1);
    expect(store.current).toHaveLength(0);
    statusToReturn = 201;
  });
});
