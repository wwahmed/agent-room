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
} from '../lib/api.js';

interface UseRoomState {
  room: Room | null;
  messages: Message[];
  error: string | null;
  /** T-07: true while polls are failing AFTER the room has loaded. The UI shows
   *  a small "reconnecting" hint instead of replacing the whole screen — a
   *  mid-session blip must never wipe an already-rendered room. */
  degraded: boolean;
  /** T-62: the server's ABSOLUTE message counter (survives LTRIM). This is the
   *  currency the unread badge is denominated in — the retained list length
   *  would silently under-count once history is trimmed. */
  messageTotal: number;
}

// T-07: users were seeing a raw "TypeError: Failed to fetch" fill the screen
// when the first fetch fired before the network was up (typical on a phone
// resuming from background). Map transport-level noise to something a human
// can act on; keep real server messages as-is.
export function friendlyError(e: unknown): string {
  const s = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  if (/failed to fetch|networkerror|load failed|fetch failed|abort/i.test(s)) {
    return "Can't reach the room server. Check your connection — retrying automatically.";
  }
  return s;
}

export function useRoom(code: string, selfName: string) {
  const [state, setState] = useState<UseRoomState>({ room: null, messages: [], error: null, degraded: false, messageTotal: 0 });
  const cursor = useRef(0);
  const clientRef = useRef(createClient());

  // In-flight guard with TIMEOUT escape hatch. Two failure modes we hit:
  //
  // 1. WITHOUT a guard, two setInterval fires can overlap. Robin's console
  //    showed `fire {cursor: 71}` followed 700ms later by `fire {cursor: 71}`
  //    again, both reading the same cursor and both running `cursor +=
  //    fresh.length` blindly → cursor over-advanced past list length →
  //    every subsequent poll returned [] forever (symptom: foreground tab,
  //    polling alive, but new messages don't surface until ⟳ Sync).
  //
  // 2. WITH a naive boolean guard, if Redis hangs silently the `await` never
  //    resolves, finally never runs, every subsequent poll bails forever.
  //    Same end-user symptom from a different angle.
  //
  // Fix: timestamp guard. A poll bails ONLY if a prior poll started < 10s
  // ago. Anything older is presumed dead and replaced.
  const inFlightRef = useRef<number | null>(null);
  const pullMessages = useCallback(async () => {
    const tNow = Date.now();
    if (inFlightRef.current !== null && tNow - inFlightRef.current < 10_000) {
      return;
    }
    inFlightRef.current = tNow;
    // TEMPORARY instrumentation — remove once Robin confirms the foreground
    // sync bug ("agent message doesn't appear unless I hit Sync") is fixed.
    const traceTag = `[useRoom:${code.slice(0, 3)}]`;
    const startedAt = Date.now();
    console.debug(traceTag, 'pullMessages.fire', { cursor: cursor.current, t: startedAt });
    try {
      const fresh = await listMessages(clientRef.current, code, cursor.current);
      // T-07: any successful poll heals both failure indicators. Before this,
      // only forceRefresh cleared `error`, so a single failed poll left the
      // full-screen error up until the next visibilitychange — the "transient
      // error that eventually goes away" Waqas reported.
      setState(s => (s.error !== null || s.degraded) ? { ...s, error: null, degraded: false } : s);
      console.debug(traceTag, 'pullMessages.fetched', {
        fresh: fresh.length,
        ms: Date.now() - startedAt,
        senders: fresh.map(m => `${m.name}(${m.client})`),
        ids: fresh.map(m => m.id),
        cursorBefore: cursor.current,
      });
      if (fresh.length === 0) {
        // Self-heal: if our local cursor has somehow over-advanced past
        // the server's absolute counter (network race / earlier bug /
        // clock skew), every future poll returns [] forever. Detect
        // and reset.
        const total = await getMessageTotalCount(clientRef.current, code);
        if (total !== null && cursor.current > total) {
          cursor.current = 0;
          const recover = await listMessages(clientRef.current, code, 0);
          cursor.current = total;
          setState(s => {
            const seen = new Set(s.messages.map(m => m.id));
            const deduped = recover.filter(m => !seen.has(m.id));
            if (deduped.length === 0) return s;
            return { ...s, messages: [...s.messages, ...deduped] };
          });
        }
        return;
      }
      // CRITICAL: anchor cursor to the server's absolute counter, never
      // blind-increment by fresh.length. The blind path lets cursor drift
      // ahead under concurrent fires / window-focus refreshes etc., and
      // once cursor sits past a real message's index that message is
      // permanently invisible to the polling path (only forceRefresh from
      // cursor=0 recovers it). This is the bug Robin's traces caught:
      // his PING was at list index 78 but cursor was already 79 by the
      // time anyone polled, so listMessages(..., 79) skipped right over.
      //
      // Setting cursor.current = total enforces "we've now seen exactly
      // what the server has" regardless of how the local arithmetic went.
      // Two concurrent polls will both write the same value → no drift.
      const total = await getMessageTotalCount(clientRef.current, code);
      cursor.current = total ?? (cursor.current + fresh.length);
      const anchored = cursor.current;
      setState(s => {
        const seen = new Set(s.messages.map(m => m.id));
        const deduped = fresh.filter(m => !seen.has(m.id));
        console.debug(traceTag, 'pullMessages.dedup', {
          freshIds: fresh.map(m => m.id),
          existingCount: s.messages.length,
          dedupedCount: deduped.length,
          newCursor: cursor.current,
          serverTotal: total,
        });
        if (deduped.length === 0) {
          return s.messageTotal === anchored ? s : { ...s, messageTotal: anchored };
        }
        return { ...s, messages: [...s.messages, ...deduped], messageTotal: anchored };
      });
    } catch (e) {
      console.debug(traceTag, 'pullMessages.error', e);
      // T-07: a failure with the room already on screen degrades quietly (the
      // interval keeps retrying); only a failure with NOTHING loaded yet may
      // claim the screen, and then with an actionable message, not a raw
      // TypeError.
      setState(s => s.room
        ? (s.degraded ? s : { ...s, degraded: true })
        : { ...s, error: friendlyError(e) });
    } finally {
      inFlightRef.current = null;
    }
  }, [code]);

  const pullRoom = useCallback(async () => {
    try {
      const r = await getRoom(clientRef.current, code);
      setState(s => ({ ...s, room: r, error: null, degraded: false }));
    } catch (e) {
      setState(s => s.room
        ? (s.degraded ? s : { ...s, degraded: true })
        : { ...s, error: friendlyError(e) });
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
      setState({ room: r, messages: fresh, error: null, degraded: false, messageTotal: cursor.current });
    } catch (e) {
      setState(s => s.room
        ? (s.degraded ? s : { ...s, degraded: true })
        : { ...s, error: friendlyError(e) });
    }
  }, [code]);

  useEffect(() => {
    cursor.current = 0;
    setState({ room: null, messages: [], error: null, degraded: false, messageTotal: 0 });

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

    // When alt-tabbing back to the browser, `focus` can fire without a
    // reliable `visibilitychange` in some edge cases — catch up incrementally.
    let focusDebounce: ReturnType<typeof setTimeout> | null = null;
    const onWinFocus = () => {
      if (document.hidden) return;
      if (focusDebounce) clearTimeout(focusDebounce);
      focusDebounce = setTimeout(() => {
        focusDebounce = null;
        void pullRoom();
        void pullMessages();
      }, 150);
    };
    window.addEventListener('focus', onWinFocus);

    start(document.hidden);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onWinFocus);
      if (focusDebounce) clearTimeout(focusDebounce);
      stop();
    };
  }, [code, selfName, pullRoom, pullMessages, forceRefresh]);

  const sendMessage = useCallback(async (msg: Message) => {
    // Optimistic render: add to local state IMMEDIATELY so the sender
    // sees their own message in the feed without waiting for the
    // round-trip to Upstash + the follow-up pullMessages. Without this,
    // hitting Enter shows a ~800-1500ms delay before the message
    // appears, which feels like the app froze. Slack / Discord /
    // iMessage all do this.
    //
    // Dedup safety: pullMessages will fetch this same msg back from
    // Redis (same id we just RPUSHed) and skip it via the Set-membership
    // dedup. So no duplicate render.
    setState(s => {
      if (s.messages.some(m => m.id === msg.id)) return s;
      return { ...s, messages: [...s.messages, msg] };
    });

    try {
      await appendMessage(clientRef.current, code, msg);
      await pullMessages();
    } catch (e) {
      // Roll back the optimistic add — server didn't accept the message.
      // The composer's catch in Room.tsx restores the draft text so the
      // user can retry. This keeps state honest if the network failed
      // or appendMessage rejected (e.g. host muted us).
      setState(s => ({
        ...s,
        messages: s.messages.filter(m => m.id !== msg.id),
      }));
      throw e;
    }
  }, [code, pullMessages]);

  return { ...state, sendMessage, refreshRoom: pullRoom, forceRefresh };
}
