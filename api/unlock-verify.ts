// Vercel Function: verify a paid-unlock token for a room report.
//
// Pilot flow:
//   1. Customer pays via Stripe Payment Link (room code passed as
//      `client_reference_id` in the checkout URL).
//   2. Robin sees the payment in Stripe dashboard, runs a one-liner to
//      compute the HMAC unlock token for that room code, and emails the
//      customer their unlock URL:
//        https://www.agent-room.com/r/CODE/report?unlock=TOKEN
//   3. Customer opens the URL. The Report page calls this endpoint to
//      validate the token, then stores it in localStorage so subsequent
//      visits skip the validation hop.
//
// The HMAC scheme uses a single server-side secret (`UNLOCK_SECRET`),
// so per-report tokens are deterministic — Robin doesn't have to track
// per-customer state, just runs the one-liner whenever a payment lands.
// Rotating UNLOCK_SECRET invalidates ALL outstanding unlock URLs (use
// for bulk revoke if a token leaks).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

const TOKEN_LENGTH = 16; // hex chars; HMAC-SHA256 truncated to 64 bits — enough entropy for 3-digit pilot

function expectedToken(code: string, secret: string): string {
  return createHmac('sha256', secret).update(code).digest('hex').slice(0, TOKEN_LENGTH);
}

export default function handler(req: VercelRequest, res: VercelResponse): void {
  // Allow GET (so the page can fetch with credentials:'omit') and POST.
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed', message: 'Use GET or POST.' });
    return;
  }

  const secret = process.env.UNLOCK_SECRET;
  if (!secret) {
    res.status(503).json({
      error: 'unlock_not_configured',
      message: 'Set UNLOCK_SECRET in Vercel env vars to enable paid unlocks.',
    });
    return;
  }

  // Accept params from query string (GET) or JSON body (POST).
  const params = req.method === 'GET'
    ? (req.query as { code?: string; token?: string })
    : ((req.body ?? {}) as { code?: string; token?: string });

  const code = typeof params.code === 'string' ? params.code : '';
  const token = typeof params.token === 'string' ? params.token : '';

  if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code)) {
    res.status(400).json({ error: 'bad_room_code', message: 'Missing or malformed room code.' });
    return;
  }
  if (!/^[a-f0-9]{16}$/.test(token)) {
    // Bad shape — short-circuit before crypto compare.
    res.status(403).json({ valid: false, error: 'invalid_token' });
    return;
  }

  const expected = expectedToken(code, secret);
  // Constant-time compare so a malicious user can't binary-search the
  // token by timing the response. Both buffers are exactly the same
  // length (regex above guarantees it) so timingSafeEqual is safe.
  const ok = timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(token, 'utf8'));

  if (!ok) {
    res.status(403).json({ valid: false, error: 'invalid_token' });
    return;
  }

  // Long cache so a customer revisiting the report doesn't re-hit our
  // function on every page load. Hits are cheap, but free tier limits
  // are still finite.
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(200).json({ valid: true, code });
}
