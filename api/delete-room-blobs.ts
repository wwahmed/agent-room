// Vercel Function: bulk-delete every blob under a given room's prefix.
// Called from Room.tsx handleEndMeeting() so attachments don't outlive
// the meeting, per Robin's requirement: "结束会议时清掉附件". Idempotent —
// calling on an already-empty prefix is a no-op.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list, del } from '@vercel/blob';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed', message: 'Use POST.' });
    return;
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    // Best-effort cleanup — no Blob = nothing to clean up. Don't block endRoom.
    res.status(200).json({ ok: true, deleted: 0, note: 'blob_not_configured' });
    return;
  }

  const body = (req.body ?? {}) as { roomCode?: unknown };
  const roomCode = body.roomCode;
  if (typeof roomCode !== 'string' || !/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(roomCode)) {
    res.status(400).json({ error: 'bad_room_code', message: 'Missing or malformed roomCode.' });
    return;
  }

  let cursor: string | undefined;
  let deleted = 0;
  const MAX_PAGES = 20;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await list({ prefix: `rooms/${roomCode}/`, cursor });
    if (result.blobs.length === 0) break;
    await del(result.blobs.map(b => b.url));
    deleted += result.blobs.length;
    if (!result.hasMore) break;
    cursor = result.cursor;
  }

  res.status(200).json({ ok: true, deleted });
}
