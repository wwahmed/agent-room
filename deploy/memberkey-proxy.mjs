#!/usr/bin/env node
// T-31: member-credential injecting proxy for the closed-source
// `agent-room-mcp` 0.25.x client.
//
// The 0.25.x wire carries only {code,name,text,...} — it cannot present the
// T-30 memberKey. Rather than fork the closed client, each agent points its
// AGENT_ROOM_BASE_URL at this proxy WITH A PER-AGENT TOKEN in the path:
//
//     AGENT_ROOM_BASE_URL=http://127.0.0.1:8211/t/<agent-secret>
//
// The MCP client treats that as an opaque base and appends `/api/room`, so the
// proxy receives `/t/<secret>/api/room`. The proxy:
//   - namespaces a member-credential store by <secret> (so agent B can never
//     read agent A's key — different, in-memory namespace);
//   - forces `wantMemberKey:true` on `join`, captures the returned `memberKey`
//     into store[secret][code], and STRIPS it from the response so the agent
//     (and its transcript/logs) never see it;
//   - injects the stored `memberKey` into `send` / `updatePresence` /
//     self-`removeParticipant` bodies before forwarding upstream.
//
// The plaintext key lives ONLY in this process's memory, keyed by the agent's
// secret. It is never written to disk, never logged, never placed in chat.
//
// Env: PROXY_PORT (default 8211), UPSTREAM (default http://127.0.0.1:8210).

import http from 'node:http';

const PORT = Number(process.env.PROXY_PORT || 8211);
const UPSTREAM = new URL(process.env.UPSTREAM || 'http://127.0.0.1:8210');

/** secret -> Map<roomCode, memberKey>. In-memory only. */
const keyStore = new Map();
function keysFor(secret) {
  let m = keyStore.get(secret);
  if (!m) { m = new Map(); keyStore.set(secret, m); }
  return m;
}

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > 6_000_000) { rej(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}

function forward(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const up = http.request(
      { hostname: UPSTREAM.hostname, port: UPSTREAM.port, path, method, headers },
      (r) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => resolve({ status: r.statusCode || 502, headers: r.headers, body: Buffer.concat(chunks) }));
      },
    );
    up.on('error', reject);
    if (body && body.length) up.write(body);
    up.end();
  });
}

const server = http.createServer(async (req, res) => {
  try {
    // Path shape: /t/<secret>/<upstream-path...>
    const m = /^\/t\/([^/]+)(\/.*)?$/.exec(req.url || '');
    if (!m) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"proxy: expected /t/<secret>/..."}'); return; }
    const secret = decodeURIComponent(m[1]);
    const upstreamPath = m[2] || '/';
    const raw = await readBody(req);

    let outBody = raw;
    const isRoom = req.method === 'POST' && upstreamPath === '/api/room';
    let action = '';
    if (isRoom) {
      let payload;
      try { payload = JSON.parse(raw.toString('utf8') || '{}'); } catch { payload = null; }
      if (payload && typeof payload === 'object') {
        action = String(payload.action || '');
        const code = String(payload.code || '');
        if (action === 'join') {
          payload.wantMemberKey = true;
        } else if (action === 'send' || action === 'updatePresence') {
          const k = keysFor(secret).get(code);
          if (k) payload.memberKey = k;
        } else if (action === 'removeParticipant' && payload.requesterName && payload.requesterName === payload.targetName) {
          const k = keysFor(secret).get(code);
          if (k) payload.memberKey = k;
        }
        outBody = Buffer.from(JSON.stringify(payload));
      }
    }

    // Rebuild headers for upstream (fix content-length, drop hop-by-hop host).
    const headers = { ...req.headers };
    delete headers['host'];
    headers['content-length'] = String(outBody.length);

    const upRes = await forward(req.method || 'GET', upstreamPath, headers, outBody);

    // Capture + strip the memberKey from join responses.
    let respBody = upRes.body;
    if (isRoom && action === 'join' && upRes.status === 200) {
      try {
        const j = JSON.parse(upRes.body.toString('utf8'));
        if (j && typeof j === 'object' && typeof j.memberKey === 'string') {
          const code = String((j.room && j.room.code) || '');
          if (code) keysFor(secret).set(code, j.memberKey);
          delete j.memberKey; // never let the plaintext reach the agent/logs
          respBody = Buffer.from(JSON.stringify(j));
        }
      } catch { /* non-JSON: pass through */ }
    }

    const outHeaders = { ...upRes.headers };
    outHeaders['content-length'] = String(respBody.length);
    res.writeHead(upRes.status, outHeaders);
    res.end(respBody);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'proxy_error', message: String(e && e.message || e) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[memberkey-proxy] listening on http://127.0.0.1:${PORT} -> ${UPSTREAM.origin}`);
});
