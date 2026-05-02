import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message, Room } from '@agent-room/shared';
import {
  HEARTBEAT_MS,
  MESSAGE_POLL_MS,
  MESSAGE_POLL_HIDDEN_MS,
  ROOM_POLL_MS,
  ROOM_POLL_HIDDEN_MS,
} from '@agent-room/shared';
import {
  createClient,
  getRoom,
  listMessages,
  appendMessage,
  updatePresence,
  getMessageTotalCount,
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
      const [r, fresh, total] = await Promise.all([
        getRoom(clientRef.current, code),
        listMessages(clientRef.current, code, 0),
        getMessageTotalCount(clientRef.current, code),
      ]);
      // Match server-side logical cursor (counter) so polling stays correct after LTRIM; legacy rooms fall back.
      cursor.current = total ?? fresh.length;
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

    const stop = () => {
      if (msgTimer) { clearInterval(msgTimer); msgTimer = null; }
      if (roomTimer) { clearInterval(roomTimer); roomTimer = null; }
      if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
    };

    const start = (slow: boolean) => {
      if (msgTimer) return; // already running
      pullRoom();
      pullMessages();
      const msgMs = slow ? MESSAGE_POLL_HIDDEN_MS : MESSAGE_POLL_MS;
      const roomMs = slow ? ROOM_POLL_HIDDEN_MS : ROOM_POLL_MS;
      msgTimer = setInterval(pullMessages, msgMs);
      roomTimer = setInterval(pullRoom, roomMs);
      hbTimer = setInterval(() => {
        updatePresence(clientRef.current, code, selfName, Date.now()).catch(() => {});
      }, HEARTBEAT_MS);
    };

    // When the tab is hidden (common: founder works in Cursor while the room
    // stays open in another window), **fully stopping** polling meant new
    // agent messages never arrived until a manual refresh — confusing next to
    // IDE-side tooling that keeps streaming. We **slow down** instead of
    // stopping to stay within reasonable Upstash budget (spec §5.5).
    const onVis = () => {
      stop();
      if (document.hidden) {
        start(true);
      } else {
        forceRefresh().finally(() => start(false));
      }
    };
    document.addEventListener('visibilitychange', onVis);

    start(document.hidden);

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
