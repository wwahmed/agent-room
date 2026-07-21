import { useState, type FormEvent } from 'react';
import type { Room } from '@agent-room/shared';
import { normalizeRoomTopic, roomTopicIssue } from '@agent-room/shared';
import { createClient, renameRoom } from '../lib/api.js';

interface Props {
  room: Room;
  isHost: boolean;
  onRenamed: () => void;
}

export function RenameRoomControl({ room, isHost, onRenamed }: Props) {
  const [editing, setEditing] = useState(false);
  const [topic, setTopic] = useState(room.topic);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isHost) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const issue = roomTopicIssue(topic);
    if (issue) { setError(issue); return; }
    setBusy(true); setError(null);
    try {
      await renameRoom(createClient(), room.code, normalizeRoomTopic(topic));
      setEditing(false);
      onRenamed();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rename the room.');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setTopic(room.topic); setError(null); setEditing(true); }}
        className="mt-1 min-h-9 rounded-md px-2 text-[12px] font-semibold text-accent transition hover:bg-accent-tint"
      >
        Edit room name
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2">
      <label className="block">
        <span className="sr-only">Room name</span>
        <input
          autoFocus
          value={topic}
          onChange={e => { setTopic(e.target.value); setError(null); }}
          aria-invalid={Boolean(roomTopicIssue(topic))}
          className="h-10 w-full rounded-lg border border-border bg-surface px-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint"
        />
      </label>
      {error && <div role="alert" className="text-[12px] font-semibold text-red-300">{error}</div>}
      <div className="flex gap-2">
        <button disabled={busy || Boolean(roomTopicIssue(topic))} className="min-h-9 rounded-lg bg-accent px-3 text-xs font-semibold text-white disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="min-h-9 rounded-lg px-3 text-xs font-semibold text-ink-soft hover:bg-surface-softer">
          Cancel
        </button>
      </div>
    </form>
  );
}
