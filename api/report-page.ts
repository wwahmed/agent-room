import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, getRoomReport } from '@agent-room/upstash-client';
import type { RoomReport } from '@agent-room/shared';

const SITE_URL = 'https://www.agent-room.com';

function readUpstashEnv(): { url: string; token: string } | { missing: string[] } {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.VITE_UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.VITE_UPSTASH_REDIS_REST_TOKEN;
  const missing = [
    !url ? 'UPSTASH_REDIS_REST_URL' : '',
    !token ? 'UPSTASH_REDIS_REST_TOKEN' : '',
  ].filter(Boolean);
  if (missing.length) return { missing };
  return { url: url!, token: token! };
}

function roomCode(value: unknown): string | null {
  const code = typeof value === 'string' ? value.toUpperCase() : '';
  return /^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code) ? code : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function metaFor(report: RoomReport | null, code: string) {
  const title = report?.topic
    ? `Agent Room Report: ${report.topic}`
    : `Agent Room Report ${code}`;
  const description = report?.summary
    ? clip(report.summary, 220)
    : 'A permanent, shareable meeting asset from an AI-agent collaboration room.';
  const url = `${SITE_URL}/r/${code}/report`;
  const image = `${SITE_URL}/api/report-og?code=${encodeURIComponent(code)}${report ? `&v=${encodeURIComponent(String(report.exportedAt))}` : ''}`;

  return { title, description, url, image };
}

function htmlPage(report: RoomReport | null, code: string): string {
  const meta = metaFor(report, code);
  const safeTitle = escapeHtml(meta.title);
  const safeDescription = escapeHtml(meta.description);
  const safeUrl = escapeHtml(meta.url);
  const safeImage = escapeHtml(meta.image);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${safeUrl}" />
    <title>${safeTitle}</title>
    <meta name="description" content="${safeDescription}" />
    <meta property="og:site_name" content="Agent Room" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${safeUrl}" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:image" content="${safeImage}" />
    <meta property="og:image:type" content="image/svg+xml" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${safeTitle}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDescription}" />
    <meta name="twitter:image" content="${safeImage}" />
    <meta http-equiv="refresh" content="0; url=${safeUrl}" />
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>${safeDescription}</p>
      <p><a href="${safeUrl}">Open the report</a></p>
    </main>
  </body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'method_not_allowed', message: 'Use GET.' });
    return;
  }

  const code = roomCode(req.query.code);
  if (!code) {
    res.status(400).send('Missing or malformed room code.');
    return;
  }

  const env = readUpstashEnv();
  let report: RoomReport | null = null;
  if (!('missing' in env)) {
    report = await getRoomReport(createClient(env), code).catch(() => null);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.status(200).send(req.method === 'HEAD' ? '' : htmlPage(report, code));
}
