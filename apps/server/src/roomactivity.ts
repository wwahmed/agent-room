// T-35: a room's last-activity timestamp for the room list (recent-first).
//
// A message can never predate its room, so activity only ever advances FORWARD
// from createdAt: the last message's `time` wins only when it is a finite value
// newer than createdAt. This makes empty rooms fall back to createdAt and keeps
// a garbage/tiny `time` (seen in old test data, e.g. time:1) from regressing a
// room to epoch 0 and mis-sorting it.
export function roomActivityAt(createdAt: number, lastMessageTime: number | undefined): number {
  const base = Number.isFinite(createdAt) && createdAt > 0 ? createdAt : 0;
  const t = Number(lastMessageTime);
  return Number.isFinite(t) && t > base ? t : base;
}
