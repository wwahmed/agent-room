import { useEffect, useRef } from 'react';
import { fetchRooms, type RoomSummary } from '../lib/identity.js';

// T-75: Home and the desktop ROOMS rail are LIVE surfaces — a room created on
// another device appears, new conversation activity re-sorts and updates
// badges, and ended rooms leave Active, all without a reload (the host's
// third report of a stale Home). The room screen already polls; this hook
// gives the LIST surfaces the same heartbeat.
//
// Cadence: 4s while the tab is visible (the acceptance bar is "appears
// within 5 seconds"), paused entirely while hidden, with an immediate
// refresh on focus/visibility return.
//
// Reading-anchor law applied to lists: a re-sort must never yank a row out
// from under the user's finger — while a pointer is down, the freshly
// fetched page is HELD and applied on pointer release.
export const LIVE_ROOMS_INTERVAL_MS = 4_000;

export function useLiveRooms(enabled: boolean, apply: (incoming: RoomSummary[]) => void): void {
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let pointerDown = false;
    let held: RoomSummary[] | null = null;

    const deliver = (rooms: RoomSummary[]) => {
      if (stopped) return;
      if (pointerDown) { held = rooms; return; }
      applyRef.current(rooms);
    };
    const tick = async () => {
      if (document.visibilityState === 'hidden') return;
      const page = await fetchRooms();
      if (page.rooms.length) deliver(page.rooms);
    };
    const onPointerDown = () => { pointerDown = true; };
    const onPointerUp = () => {
      pointerDown = false;
      if (held) { const rooms = held; held = null; deliver(rooms); }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };

    const id = window.setInterval(() => { void tick(); }, LIVE_ROOMS_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
    };
  }, [enabled]);
}
