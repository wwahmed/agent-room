// Cloudflare Access JWT validation (T-12).
//
// Every request that traverses the Access-gated tunnel carries a
// `Cf-Access-Jwt-Assertion` header signed by the team's keys. We verify
// signature (RS256 against the team JWKS), issuer, audience, and expiry
// on the origin so a spoofed plain-email header is never sufficient.
// Localhost callers (the Claude/Codex MCP processes on this Mac) never
// traverse the edge and are trusted as `local`.
//
// Env:
//   ACCESS_TEAM_DOMAIN  e.g. wakilabs.cloudflareaccess.com
//   ACCESS_AUD          the Access application audience tag
//   ALLOWED_EMAILS      comma-separated allowlist (defaults to IDENTITY_MAP keys)

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

const TEAM_DOMAIN = process.env.ACCESS_TEAM_DOMAIN || 'wakilabs.cloudflareaccess.com';
const ACCESS_AUD = process.env.ACCESS_AUD || '';

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 10 * 60 * 1000;

async function getJwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const resp = await fetch(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`);
  if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`);
  const body = (await resp.json()) as { keys: Jwk[] };
  jwksCache = { keys: body.keys, fetchedAt: Date.now() };
  return body.keys;
}

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export interface AccessClaims {
  email: string;
  exp: number;
  iss: string;
  aud: string[] | string;
}

/** Verify a Cf-Access-Jwt-Assertion. Returns claims on success, null on any failure. */
export async function verifyAccessJwt(token: string): Promise<AccessClaims | null> {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const header = JSON.parse(b64urlToBuf(h).toString('utf8')) as { kid?: string; alg?: string };
    if (header.alg !== 'RS256' || !header.kid) return null;
    const keys = await getJwks();
    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) return null;
    const publicKey = createPublicKey({ key: jwk as unknown as Record<string, unknown>, format: 'jwk' });
    const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, b64urlToBuf(s));
    if (!ok) return null;
    const claims = JSON.parse(b64urlToBuf(p).toString('utf8')) as AccessClaims;
    if (claims.iss !== `https://${TEAM_DOMAIN}`) return null;
    if (claims.exp * 1000 < Date.now()) return null;
    if (ACCESS_AUD) {
      const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!auds.includes(ACCESS_AUD)) return null;
    }
    if (!claims.email) return null;
    return claims;
  } catch {
    return null;
  }
}

export function allowedEmails(): Set<string> {
  const explicit = (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  if (explicit.length > 0) return new Set(explicit);
  try {
    const map = JSON.parse(process.env.IDENTITY_MAP || '{}') as Record<string, unknown>;
    return new Set(Object.keys(map).map(k => k.toLowerCase()));
  } catch {
    return new Set();
  }
}
