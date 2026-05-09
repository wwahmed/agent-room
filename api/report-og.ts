import type { VercelRequest, VercelResponse } from '@vercel/node';

// Hotfix: see api/report-page.ts for the full rationale. Same workspace-
// import problem (`@agent-room/upstash-client` ships TypeScript source
// via `"main": "./src/index.ts"`, which Node can't load at runtime), so
// the import was crashing the function before the handler ran. This
// inlines a minimal Upstash REST GET + the report-shape subset we
// actually consult.

const FALLBACK_TITLE = 'Agent Room Report';
const FALLBACK_DESCRIPTION = 'A shareable meeting asset from a multi-agent collaboration room.';

interface MiniParticipant {
  name: string;
  client?: string;
}

interface MiniReport {
  topic?: string;
  summary?: string;
  exportedAt?: number;
  messageCount?: number;
  participants?: MiniParticipant[];
}

async function getRoomReportRaw(
  url: string,
  token: string,
  code: string
): Promise<MiniReport | null> {
  let resp: Response;
  try {
    resp = await fetch(`${url.replace(/\/$/, '')}/get/room-report:${encodeURIComponent(code)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
  if (!resp.ok) return null;
  let body: { result?: string | null };
  try {
    body = (await resp.json()) as { result?: string | null };
  } catch {
    return null;
  }
  if (!body.result) return null;
  try {
    return JSON.parse(body.result) as MiniReport;
  } catch {
    return null;
  }
}

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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function reportSummary(report: MiniReport | null): { title: string; description: string; details: string[] } {
  if (!report) {
    return {
      title: FALLBACK_TITLE,
      description: FALLBACK_DESCRIPTION,
      details: ['Permanent report link', 'Transcript, decisions, and action items', 'Human-steered agent collaboration'],
    };
  }

  const participants = report.participants ?? [];
  const agents = participants
    .filter(p => p.client !== 'web')
    .map(p => p.name)
    .slice(0, 3);
  const details = [
    `${report.messageCount ?? 0} messages`,
    `${participants.length} participants`,
    agents.length ? `Agents: ${agents.join(', ')}` : 'Meeting asset',
  ];
  return {
    title: `${report.topic || 'Agent Room'} report`,
    description: report.summary || FALLBACK_DESCRIPTION,
    details,
  };
}

function svgCard(report: MiniReport | null): string {
  const summary = reportSummary(report);
  const title = escapeXml(clip(summary.title, 72));
  const description = escapeXml(clip(summary.description, 150));
  const details = summary.details.map(d => escapeXml(clip(d, 48)));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${title}">
  <rect width="1200" height="630" fill="#F7F3EA"/>
  <rect x="52" y="52" width="1096" height="526" rx="34" fill="#111318"/>
  <circle cx="996" cy="128" r="54" fill="#5B6AFF"/>
  <circle cx="1064" cy="186" r="34" fill="#23C55E"/>
  <circle cx="932" cy="196" r="26" fill="#F59E0B"/>
  <text x="104" y="126" fill="#F7F3EA" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="800" letter-spacing="4">AGENT ROOM REPORT</text>
  <text x="104" y="238" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="64" font-weight="850">${title}</text>
  <foreignObject x="104" y="278" width="880" height="136">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Inter, Arial, sans-serif; font-size: 30px; line-height: 1.35; color: #D9DEE8;">${description}</div>
  </foreignObject>
  <g font-family="Inter, Arial, sans-serif" font-size="26" font-weight="700">
    <rect x="104" y="460" width="292" height="58" rx="29" fill="#F7F3EA"/>
    <text x="132" y="498" fill="#111318">${details[0] ?? 'Permanent report'}</text>
    <rect x="420" y="460" width="324" height="58" rx="29" fill="#E3E8F5"/>
    <text x="448" y="498" fill="#111318">${details[1] ?? 'Share asset'}</text>
    <rect x="768" y="460" width="328" height="58" rx="29" fill="#DDF7E8"/>
    <text x="796" y="498" fill="#111318">${details[2] ?? 'Agent collaboration'}</text>
  </g>
</svg>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'method_not_allowed', message: 'Use GET.' });
    return;
  }

  const code = roomCode(req.query.code);
  if (!code) {
    res.status(400).json({ error: 'bad_room_code', message: 'Missing or malformed room code.' });
    return;
  }

  const env = readUpstashEnv();
  let report: MiniReport | null = null;
  if (!('missing' in env)) {
    report = await getRoomReportRaw(env.url, env.token, code).catch(() => null);
  }

  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.status(200).send(req.method === 'HEAD' ? '' : svgCard(report));
}
