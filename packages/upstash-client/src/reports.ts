import { extractArtifacts, type Message, type Room, type RoomReport } from '@agent-room/shared';
import type { UpstashClient } from './client.js';

function reportKey(code: string): string { return `room-report:${code}`; }

export function buildRoomReport(room: Room, messages: Message[]): RoomReport {
  const userMessages = messages.filter(m => m.type === 'msg' && m.text.trim());
  const artifacts = extractArtifacts(userMessages);
  const highlights = pickLines(userMessages, 8);
  const markedDecisions = artifacts.filter(a => a.kind === 'decision').map(a => `${a.author}: ${clip(a.text)}`);
  const markedTodos = artifacts.filter(a => a.kind === 'todo').map(a => `${a.author}: ${clip(a.text)}`);
  const decisions = markedDecisions.length
    ? markedDecisions.slice(0, 8)
    : pickMatching(userMessages, /(共识|决定|拍板|优先级|P0|P1|P2|P3|上线|ship|deploy|final|结论)/i, 8);
  const actionItems = markedTodos.length
    ? markedTodos.slice(0, 8)
    : pickMatching(userMessages, /(下一步|需要|建议|开始|实现|部署|改|修|todo|action|follow)/i, 8);

  return {
    code: room.code,
    topic: room.topic,
    createdAt: room.createdAt,
    exportedAt: Date.now(),
    participants: room.participants.map(p => ({
      name: p.name,
      role: p.role,
      client: p.client,
    })),
    messageCount: messages.length,
    summary: `This report captures ${messages.length} message(s) from "${room.topic}" with ${room.participants.length} participant(s). It preserves the discussion, key takeaways, decisions, and follow-up work as a shareable meeting asset.`,
    highlights,
    decisions: decisions.length ? decisions : highlights.slice(0, 3),
    actionItems: actionItems.length ? actionItems : ['Review the transcript and confirm next implementation priority.'],
    artifacts,
    transcript: messages,
  };
}

export async function createRoomReport(
  client: UpstashClient,
  room: Room,
  messages: Message[]
): Promise<RoomReport> {
  const report = buildRoomReport(room, messages);
  await client.command(['SET', reportKey(room.code), JSON.stringify(report)]);
  return report;
}

export async function getRoomReport(
  client: UpstashClient,
  code: string
): Promise<RoomReport | null> {
  const raw = await client.command<string | null>(['GET', reportKey(code)]);
  return raw ? JSON.parse(raw) as RoomReport : null;
}

function pickLines(messages: Message[], limit: number): string[] {
  const lines: string[] = [];
  for (const m of messages) {
    const first = m.text.trim().split('\n').find(line => line.trim().length > 10)?.trim();
    if (!first) continue;
    lines.push(`${m.name}: ${clip(first)}`);
    if (lines.length >= limit) break;
  }
  return lines;
}

function pickMatching(messages: Message[], pattern: RegExp, limit: number): string[] {
  const lines: string[] = [];
  for (const m of messages) {
    const matched = m.text
      .split('\n')
      .map(line => line.trim())
      .find(line => line.length > 8 && pattern.test(line));
    if (!matched) continue;
    lines.push(`${m.name}: ${clip(matched)}`);
    if (lines.length >= limit) break;
  }
  return lines;
}

function clip(text: string): string {
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}
