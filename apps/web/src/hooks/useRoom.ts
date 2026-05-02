import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message, Room } from '@agent-room/shared';
import { HEARTBEAT_MS, MESSAGE_POLL_MS, ROOM_POLL_MS } from '@agent-room/shared';
import {
  createClient,
  getRoom,
  listMessages,
  appendMessage,
  updatePresence,
} from '@agent-room/upstash-client';
import { ENV } from '../env.js';

interface UseRoomState {
  room: Room | null;
  messages: Message[];
  error: string | null;
}

export function useRoom(code: string, selfName: string) {
  const [state, setState] = useState<UseRoomState>({ room: null, messages: [], error: null });
  const cursor = useRef(0);
  const clientRef = useRef(createClient(ENV.upstash));

  const pullMessages = useCallback(async () => {
    try {
      const fresh = await listMessages(clientRef.current, code, cursor.current);
      if (fresh.length === 0) return;
      cursor.current += fresh.length;
      setState(s => {
        const seen = new Set(s.messages.map(m => m.id));
        const deduped = fresh.filter(m => !seen.has(m.id));
        if (deduped.length === 0) return s;
        return { ...s, messages: [...s.messages, ...deduped] };
      });
    } catch (e) {
      setState(s => ({ ...s, error: String(e) }));
    }
  }, [code]);

  const pullRoom = useCallback(async () => {
    try {
      const r = await getRoom(clientRef.current, code);
      setState(s => ({ ...s, room: r }));
    } catch (e) {
      setState(s => ({ ...s, error: String(e) }));
    }
  }, [code]);

  // Reset polling state to a clean slate and refetch from cursor 0. Used by
  // the visibilitychange handler (so a backgrounded tab returning gets a
  // fresh sync, not a resumed poll from stale state) and exposed as
  // `forceRefresh` so the Room UI can offer a manual "Reconnect" button
  // when users see stale data.
  //
  // Why this exists: the original implementation only paused/resumed the
  // polling intervals on visibilitychange. If the tab was hidden long
  // enough for messages to arrive AND the cursor diverge, resuming polling
  // would happily fetch from the stale cursor, miss nothing, and look
  // healthy — but the user sees an empty room because no individual fetch
  // ever caught up the gap. Now visibility-resume always re-syncs from
  // cursor 0 with dedup, so the user sees the room as it actually is.
  const forceRefresh = useCallback(async () => {
    cursor.current = 0;
    try {
      const [r, fresh] = await Promise.all([
        getRoom(clientRef.current, code),
        listMessages(clientRef.current, code, 0),
      ]);
      cursor.current = fresh.length;
      setState({ room: r, messages: fresh, error: null });
    } catch (e) {
      setState(s => ({ ...s, error: String(e) }));
    }
  }, [code]);

  useEffect(() => {
    cursor.current = 0;
    setState({ room: null, messages: [], error: null });

    let msgTimer: ReturnType<typeof setInterval> | null = null;
    let roomTimer: ReturnType<typeof setInterval> | null = null;
    let hbTimer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (msgTimer) return; // already running
      pullRoom();
      pullMessages();
      msgTimer = setInterval(pullMessages, MESSAGE_POLL_MS);
      roomTimer = setInterval(pullRoom, ROOM_POLL_MS);
      hbTimer = setInterval(() => {
        updatePresence(clientRef.current, code, selfName, Date.now()).catch(() => {});
      }, HEARTBEAT_MS);
    };
    const stop = () => {
      if (msgTimer) { clearInterval(msgTimer); msgTimer = null; }
      if (roomTimer) { clearInterval(roomTimer); roomTimer = null; }
      if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
    };

    // Pause polling when the tab is hidden to conserve Upstash quota (spec §5.5).
    // On return: stop existing timers, force a full re-sync from cursor 0
    // (catches anything that arrived while hidden), THEN resume polling.
    // Without the forceRefresh step, a hidden tab could miss messages and
    // resumed polling from the stale cursor would never see them — the
    // bug Robin hit transitioning between rooms in the same tab.
    const onVis = () => {
      if (document.hidden) {
        stop();
      } else {
        stop();
        forceRefresh().finally(start);
      }
    };
    document.addEventListener('visibilitychange', onVis);

    if (!document.hidden) start();

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, [code, selfName, pullRoom, pullMessages, forceRefresh]);

  const sendMessage = useCallback(async (msg: Message) => {
    // Propagate errors so the Room screen can show a toast
    try {
      await appendMessage(clientRef.current, code, msg);
      await pullMessages();
    } catch (e) {
      throw e;
    }
  }, [code, pullMessages]);

  return { ...state, sendMessage, refreshRoom: pullRoom, forceRefresh };
}
