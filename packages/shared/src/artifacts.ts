import type { ArtifactKind, Message, RoomArtifact } from './types.js';

const KIND_BY_MARKER: Record<string, ArtifactKind> = {
  DECISION: 'decision',
  TODO: 'todo',
  STATUS: 'status',
  RESULT: 'result',
};

// T-71 content-model fix (review-found bug): markers are intentional
// LINE-LEVEL syntax, parsed line-by-line — prose discussing a tag, quoted
// lines, fenced code examples, and 4-space indented code never manufacture
// work objects.
const MARKER_LINE = /^ {0,3}\[(DECISION|TODO|STATUS|RESULT)\]\s*(.+)/i;

export function extractArtifacts(messages: Message[]): RoomArtifact[] {
  const artifacts: RoomArtifact[] = [];

  for (const message of messages) {
    if (message.type !== 'msg') continue;
    let inFence = false;
    let indexInMessage = 0;
    for (const line of (message.text ?? '').split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const match = line.match(MARKER_LINE);
      if (!match) continue;
      const marker = match[1]?.toUpperCase();
      const text = match[2]?.trim();
      if (!marker || !text) continue;
      artifacts.push({
        // Stable PER-MESSAGE id: identical whether this message is extracted
        // alone (store time) or in a batch (backfill) — merge-by-id depends
        // on this.
        id: `${message.id}-${indexInMessage++}`,
        kind: KIND_BY_MARKER[marker] ?? 'status',
        text,
        sourceMessageId: message.id,
        author: message.name,
        time: message.time,
      });
    }
  }

  return artifacts;
}

export function artifactLabel(kind: ArtifactKind): string {
  switch (kind) {
    case 'decision':
      return 'Decision';
    case 'todo':
      return 'Todo';
    case 'status':
      return 'Status';
    case 'result':
      return 'Result';
  }
}
