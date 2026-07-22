import type { Message, MessageReaction } from '@agent-room/shared';

// T-121: reactions edit STORED messages in place (LSET), which an append-only
// polling cursor never re-reads. The server therefore appends a sys event row
// whose metadata carries the target id and the full post-change reaction list.
// This helper folds those events into an already-loaded message window so the
// chips on a rendered message update without refetching history.
//
// Events for messages outside the loaded window are no-ops (the stored row is
// authoritative — when that history is paged in later it already carries the
// reactions).
export function applyReactionEvents(messages: Message[], events: Message[]): Message[] {
  const patches = new Map<number, MessageReaction[]>();
  for (const event of events) {
    const meta = event.metadata;
    if (meta?.eventType !== 'reaction') continue;
    if (typeof meta.targetMessageId !== 'number') continue;
    if (!Array.isArray(meta.reactionsSnapshot)) continue;
    // Later events overwrite earlier ones for the same target — the snapshot
    // is the complete post-change state, not a delta.
    patches.set(meta.targetMessageId, meta.reactionsSnapshot);
  }
  if (patches.size === 0) return messages;
  let changed = false;
  const out = messages.map(m => {
    const patch = patches.get(m.id);
    if (!patch) return m;
    changed = true;
    return { ...m, reactions: patch };
  });
  // Same array identity when nothing in the window matched — no re-render.
  return changed ? out : messages;
}

/** The viewer's own reaction on a message, if any (web identity). */
export function ownReaction(message: Message, selfName: string | undefined): MessageReaction | undefined {
  if (!selfName) return undefined;
  return (message.reactions ?? []).find(r => r.name === selfName && r.client === 'web');
}
