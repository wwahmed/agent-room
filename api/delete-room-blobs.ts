// Vercel Function: bulk-delete every blob under a given room's prefix.
// Called from the endRoom path so attachments don't outlive the meeting,
// per Robin's requirement: "结束会议时清掉附件". Idempotent — calling on
// an already-empty prefix is a no-op.
//
// Authorization: same model as upload — anyone with the room code can hit
// this. In practice the host is the only one with an "End meeting" button,
// and the delete is a fan-out from that. We accept the looser auth because
// the alternative (host-key proof on every API call) is meaningfully more
// plumbing for a v1 cleanup path.

import { list, del } from '@vercel/blob';

export const config = { runtime: 'nodejs' };

interface Body {
  roomCode?: unknown;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed', 'Use POST.');
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    // Best-effort cleanup — if Blob isn't configured there's nothing to
    // clean up anyway, so report success rather than blocking endRoom.
    return Response.json({ ok: true, deleted: 0, note: 'blob_not_configured' });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON.');
  }
  const roomCode = body.roomCode;
  if (typeof roomCode !== 'string' || !/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(roomCode)) {
    return jsonError(400, 'bad_room_code', 'Missing or malformed roomCode.');
  }

  let cursor: string | undefined;
  let deleted = 0;
  // Paginate — list returns a page at a time; under our 10 MB / 5-per-msg /
  // 500-msgs cap a single room can hold up to 2500 blobs, well within a few
  // pages. Stop after a sane upper bound so a runaway prefix doesn't burn
  // the function budget.
  const MAX_PAGES = 20;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await list({ prefix: `rooms/${roomCode}/`, cursor });
    if (result.blobs.length === 0) break;
    await del(result.blobs.map(b => b.url));
    deleted += result.blobs.length;
    if (!result.hasMore) break;
    cursor = result.cursor;
  }

  return Response.json({ ok: true, deleted });
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status });
}
