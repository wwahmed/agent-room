// Vercel Function: Stripe webhook handler.
//
// When a customer pays via the Payment Link, Stripe POSTs a
// `checkout.session.completed` event here. We:
//   1. Verify the Stripe signature so a third party can't forge a
//      payment notification.
//   2. Pull the room code (passed as `client_reference_id`) and the
//      customer's email.
//   3. Compute the HMAC unlock token for that room — same scheme as
//      /api/unlock-verify so the URL the customer receives passes
//      validation when they open it.
//   4. Send a "Your AI Room report is unlocked" email via Resend.
//
// What this replaces: the manual "see Stripe payment → run Node
// one-liner → copy URL → paste into Gmail" loop. Robin can sleep
// through pilots after this lands.
//
// Required env vars (Vercel project settings):
//   STRIPE_WEBHOOK_SECRET   — `whsec_...` from Stripe dashboard's webhook
//   UNLOCK_SECRET           — same value already used by unlock-verify
//   RESEND_API_KEY          — `re_...` from resend.com dashboard
//   RESEND_FROM_EMAIL       — verified sender, e.g. `noreply@agent-room.com`
//                             (or `onboarding@resend.dev` while testing)
//
// Stripe webhook configuration:
//   URL:    https://www.agent-room.com/api/stripe-webhook
//   Events: checkout.session.completed
//
// Stripe sends raw bytes; signature verification needs the raw body
// pre-parse, so the bodyParser is disabled and we buffer manually.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const config = { api: { bodyParser: false } };

const TOKEN_LENGTH = 16;
const PUBLIC_BASE = 'https://www.agent-room.com';

let cachedStripe: Stripe | null = null;
function getStripe(): Stripe {
  if (cachedStripe) return cachedStripe;
  // The Stripe constructor wants an API key. Webhook signature
  // verification only uses the webhook secret, not the API key, but
  // the constructor still throws without one — pass a placeholder.
  // Don't make any client.* calls in this file or the placeholder
  // will hit the actual Stripe API and 401.
  cachedStripe = new Stripe('sk_webhook_only_no_api_calls', {
    apiVersion: '2024-11-20.acacia',
  });
  return cachedStripe;
}

function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function unlockToken(code: string, secret: string): string {
  return createHmac('sha256', secret).update(code).digest('hex').slice(0, TOKEN_LENGTH);
}

interface SendEmailInput {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function sendEmail(input: SendEmailInput): Promise<void> {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: input.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Resend API ${resp.status}: ${body}`);
  }
}

function unlockEmailContent(roomCode: string, unlockUrl: string, amount: string): { subject: string; html: string; text: string } {
  const subject = `Your AI Room report is unlocked (${roomCode})`;

  // Plain-text version for clients that don't render HTML or for
  // when an MUA strips it. Identical info, no styling.
  const text = [
    `Hi,`,
    ``,
    `Thanks for unlocking your AI Room delivery report — payment of ${amount} received.`,
    ``,
    `Your unlock URL:`,
    unlockUrl,
    ``,
    `What it does:`,
    `1. Click the URL once. The watermark drops and your browser remembers.`,
    `2. After that, share the clean URL with your client:`,
    `   ${PUBLIC_BASE}/r/${roomCode}/report`,
    `   Anyone opening that sees the watermark-free version with no expiry.`,
    `3. Markdown downloads from the same page are also clean.`,
    ``,
    `Questions? Just reply to this email.`,
    ``,
    `— Robin, AI Room`,
    `${PUBLIC_BASE}`,
  ].join('\n');

  // HTML version. Plain inline styles only — most email clients
  // (Gmail, Outlook) strip <style> blocks. No external assets so
  // the email looks the same offline.
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111318;">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
    <div style="padding:24px 28px;border-bottom:1px solid #eef0f3;">
      <div style="font-size:11px;font-weight:600;letter-spacing:0.12em;color:#5B6AFF;text-transform:uppercase;">AI Room — Delivery Report</div>
      <h1 style="font-size:22px;line-height:1.3;margin:8px 0 0;letter-spacing:-0.01em;color:#111318;">Payment received — your report is unlocked</h1>
    </div>
    <div style="padding:24px 28px;">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
        Thanks for supporting AI Room. We received <strong>${amount}</strong> for room <code style="background:#f4f5f7;border:1px solid #eef0f3;padding:2px 6px;border-radius:4px;font-size:13px;">${roomCode}</code>.
      </p>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">
        Open the URL below once to remove the watermark. Your browser remembers, and the original report URL becomes shareable with no expiry.
      </p>
      <div style="text-align:center;margin:0 0 24px;">
        <a href="${unlockUrl}" style="display:inline-block;background:#5B6AFF;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px;">
          Open your unlocked report
        </a>
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#6B7280;">Or copy this URL:</p>
      <p style="margin:0 0 24px;word-break:break-all;font-size:12px;font-family:ui-monospace,'SF Mono',Menlo,monospace;color:#374151;background:#f4f5f7;border:1px solid #eef0f3;border-radius:6px;padding:10px 12px;">${unlockUrl}</p>
      <hr style="border:none;border-top:1px solid #eef0f3;margin:24px 0;">
      <h2 style="font-size:14px;font-weight:600;margin:0 0 10px;color:#111318;">What it does</h2>
      <ol style="margin:0 0 20px;padding-left:20px;font-size:14px;line-height:1.7;color:#374151;">
        <li>Click the URL once. Watermark drops; browser remembers.</li>
        <li>Share the clean report URL with your client:<br><a href="${PUBLIC_BASE}/r/${roomCode}/report" style="color:#5B6AFF;">${PUBLIC_BASE}/r/${roomCode}/report</a></li>
        <li>Markdown downloads from that page are also clean — drop into a delivery email or git repo.</li>
      </ol>
      <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6;">
        Questions or the URL doesn't work? Reply to this email.
      </p>
    </div>
    <div style="padding:18px 28px;background:#fafbfc;border-top:1px solid #eef0f3;font-size:12px;color:#9CA3AF;text-align:center;">
      <a href="${PUBLIC_BASE}" style="color:#9CA3AF;text-decoration:none;">AI Room</a>
       — multi-agent meeting rooms with structured delivery reports.
    </div>
  </div>
</body>
</html>`;

  return { subject, html, text };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed', message: 'Use POST.' });
    return;
  }

  // Each piece is required — bail with a clear, single error rather
  // than letting the SDK produce a cryptic message later in the flow.
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const unlockSecret = process.env.UNLOCK_SECRET;
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const missing: string[] = [];
  if (!webhookSecret) missing.push('STRIPE_WEBHOOK_SECRET');
  if (!unlockSecret) missing.push('UNLOCK_SECRET');
  if (!resendApiKey) missing.push('RESEND_API_KEY');
  if (!fromEmail) missing.push('RESEND_FROM_EMAIL');
  if (missing.length) {
    res.status(503).json({
      error: 'webhook_not_configured',
      message: `Missing env vars: ${missing.join(', ')}`,
    });
    return;
  }

  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req);
  } catch {
    res.status(400).json({ error: 'cannot_read_body' });
    return;
  }

  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string' || signature.length === 0) {
    res.status(400).json({ error: 'missing_signature', message: 'No stripe-signature header.' });
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret!);
  } catch (e) {
    // Forged or stale request. 400 — Stripe will treat as failure and
    // retry with backoff (which is fine; eventually it gives up).
    res.status(400).json({
      error: 'invalid_signature',
      message: e instanceof Error ? e.message : 'Signature verification failed.',
    });
    return;
  }

  // We only care about completed Checkout sessions. Stripe ships many
  // other events (`payment_intent.*`, `customer.*`, etc.) — ignore
  // them with a 200 so Stripe doesn't retry.
  if (event.type !== 'checkout.session.completed') {
    res.status(200).json({ ok: true, ignored: event.type });
    return;
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // The room code travels in `client_reference_id` (the Payment Link
  // URL is constructed in FreeTierFooter to include it). Without it
  // we can't know which report to unlock, so we ack the event but
  // don't act on it.
  const code = typeof session.client_reference_id === 'string' ? session.client_reference_id : null;
  const email = session.customer_details?.email ?? session.customer_email ?? null;

  if (!code || !/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code)) {
    res.status(200).json({ ok: true, ignored: 'missing_or_bad_room_code' });
    return;
  }
  if (!email) {
    res.status(200).json({ ok: true, ignored: 'missing_email' });
    return;
  }
  if (session.payment_status !== 'paid') {
    res.status(200).json({ ok: true, ignored: 'unpaid', status: session.payment_status });
    return;
  }

  const token = unlockToken(code, unlockSecret!);
  const unlockUrl = `${PUBLIC_BASE}/r/${code}/report?unlock=${token}`;

  // Format the amount for the email body (Stripe gives integer
  // minor-units; for USD that's cents). Fall back to the configured
  // product price if the session somehow lacks an amount_total.
  const amountMinor = session.amount_total ?? 0;
  const currency = (session.currency ?? 'usd').toUpperCase();
  const amountStr = currency === 'USD'
    ? `$${(amountMinor / 100).toFixed(2)}`
    : `${currency} ${(amountMinor / 100).toFixed(2)}`;

  const content = unlockEmailContent(code, unlockUrl, amountStr);

  try {
    await sendEmail({
      apiKey: resendApiKey!,
      from: fromEmail!,
      to: email,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
  } catch (e) {
    // Email failed. Return 500 so Stripe retries — one of the retry
    // attempts will eventually succeed (Resend hiccup, transient
    // network, etc.). The customer's data is preserved on Stripe's
    // side so a retry is safe.
    res.status(500).json({
      error: 'email_send_failed',
      message: e instanceof Error ? e.message : 'Email send failed.',
    });
    return;
  }

  res.status(200).json({ ok: true, code, sentTo: email });
}
