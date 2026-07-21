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
    // A marker opens a BLOCK that captures its continuation lines (including
    // lists) until the next marker, a fence, a quoted line, or end of message
    // — a real Decision's details are part of the decision (review finding:
    // 'Audit accepted. Priority is now locked:' stored with nothing after
    // the colon).
    let inFence = false;
    let indexInMessage = 0;
    let current: { marker: string; parts: string[] } | null = null;
    const flush = () => {
      if (!current) return;
      const blockText = current.parts.join('\n').trim();
      if (blockText) {
        artifacts.push({
          // Stable PER-MESSAGE id: identical whether this message is
          // extracted alone (store time) or in a batch (backfill) —
          // merge-by-id depends on this.
          id: `${message.id}-${indexInMessage++}`,
          kind: KIND_BY_MARKER[current.marker] ?? 'status',
          text: blockText,
          sourceMessageId: message.id,
          author: message.name,
          time: message.time,
        });
      }
      current = null;
    };
    for (const line of (message.text ?? '').split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) { flush(); inFence = !inFence; continue; }
      if (inFence) continue;
      const match = line.match(MARKER_LINE);
      if (match) {
        flush();
        current = { marker: (match[1] ?? '').toUpperCase(), parts: [match[2] ?? ''] };
        continue;
      }
      if (current) {
        if (/^ {0,3}>/.test(line)) { flush(); continue; }
        current.parts.push(line);
      }
    }
    flush();
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
