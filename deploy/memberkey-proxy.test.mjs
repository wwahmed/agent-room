import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const PROXY_SCRIPT = new URL('./memberkey-proxy.mjs', import.meta.url);

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

function stop(server) {
  return new Promise((resolve) => server.close(resolve));
}

function startProxy({ port, upstream, token, store }) {
  const child = spawn(process.execPath, [PROXY_SCRIPT.pathname], {
    env: {
      ...process.env,
      PROXY_PORT: String(port),
      PROXY_TOKEN: token,
      UPSTREAM: upstream,
      MEMBERKEY_STORE: store,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`proxy start timeout: ${stderr}`)), 3_000);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      if (!String(chunk).includes('listening on')) return;
      clearTimeout(timer);
      resolve(child);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`proxy exited ${code}: ${stderr}`));
    });
  });
}

function stopChild(child) {
  if (child.exitCode !== null) return Promise.resolve();
  child.kill('SIGTERM');
  return new Promise((resolve) => child.once('exit', resolve));
}

async function joinThrough(port, token) {
  const response = await fetch(`http://127.0.0.1:${port}/t/${token}/api/room`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'join',
      code: 'ABC-DEF-GHJ',
      participant: { name: 'Robin', client: 'cc' },
    }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('persists the rotated key and presents it after a proxy restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-room-proxy-'));
  const store = join(dir, 'member-keys.json');
  const token = '0123456789abcdef0123456789abcdef';
  const joins = [];
  let nextKey = 1;
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    joins.push(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      room: { code: body.code, participants: [] },
      participant: body.participant,
      memberKey: `member-key-${nextKey++}`,
    }));
  });

  let first;
  let second;
  try {
    const upstreamPort = await listen(upstream);
    const probe = createServer();
    const proxyPort = await listen(probe);
    await stop(probe);
    const config = {
      port: proxyPort,
      upstream: `http://127.0.0.1:${upstreamPort}`,
      token,
      store,
    };

    first = await startProxy(config);
    const firstBody = await joinThrough(proxyPort, token);
    assert.equal(firstBody.memberKey, undefined, 'plaintext key must be stripped');
    assert.equal(joins[0].memberKey, undefined, 'first join has no reclaim key');
    await stopChild(first);
    first = undefined;

    assert.equal(statSync(store).mode & 0o777, 0o600);
    const storedAfterFirst = JSON.stringify(JSON.parse(readFileSync(store, 'utf8')));
    assert.equal(storedAfterFirst.includes('member-key-1'), true);

    second = await startProxy(config);
    const secondBody = await joinThrough(proxyPort, token);
    assert.equal(secondBody.memberKey, undefined, 'rotated key must remain hidden');
    assert.equal(joins[1].memberKey, 'member-key-1', 'restart must present prior key');
    const storedAfterSecond = JSON.stringify(JSON.parse(readFileSync(store, 'utf8')));
    assert.equal(storedAfterSecond.includes('member-key-2'), true);
    assert.equal(storedAfterSecond.includes('member-key-1'), false);
  } finally {
    if (first) await stopChild(first);
    if (second) await stopChild(second);
    await stop(upstream);
    rmSync(dir, { recursive: true, force: true });
  }
});
