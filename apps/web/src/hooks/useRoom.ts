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
      setState(s => ({ ...s, messages: [...s.messages, ...fresh] }));
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

  useEffect(() => {
    cursor.current = 0;
    setState({ room: null, messages: [], error: null });
    pullRoom();
    pullMessages();
    const msgTimer = setInterval(pullMessages, MESSAGE_POLL_MS);
    const roomTimer = setInterval(pullRoom, ROOM_POLL_MS);
    const hbTimer = setInterval(() => {
      updatePresence(clientRef.current, code, selfName, Date.now()).catch(() => {});
    }, HEARTBEAT_MS);
    return () => { clearInterval(msgTimer); clearInterval(roomTimer); clearInterval(hbTimer); };
  }, [code, selfName, pullRoom, pullMessages]);

  const sendMessage = useCallback(async (msg: Message) => {
    // Propagate errors so the Room screen can show a toast
    try {
      await appendMessage(clientRef.current, code, msg);
      await pullMessages();
    } catch (e) {
      throw e;
    }
  }, [code, pullMessages]);

  return { ...state, sendMessage };
}
