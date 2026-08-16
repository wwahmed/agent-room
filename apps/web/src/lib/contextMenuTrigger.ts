// The press handling behind every right-click / long-press menu in the app.
//
// This logic was written once for room cards and is genuinely fiddly: Android
// and desktop both arrive through `contextmenu`, iOS needs a timer instead, a
// finger that moves is scrolling rather than pressing, and after a synthetic
// open the element's next click has to be swallowed or a stretched <Link>
// navigates out from under the menu. Agent rows need exactly the same
// behaviour, and the second copy of a subtle interaction is where the two
// quietly drift apart. So it lives here once, generic over whatever payload
// the menu needs, and each surface supplies its own.

import { useEffect, useRef, useState } from 'react';

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 12;

/** Where the menu was opened, in viewport coordinates. */
export interface MenuPoint { x: number; y: number }

export interface ContextMenuTrigger<T> {
  /** The open menu's payload plus its anchor, or null when closed. */
  menu: (T & MenuPoint) | null;
  closeMenu: () => void;
  /** Spread onto the element that should open the menu. */
  bind: (payload: T) => {
    onContextMenu: (e: React.MouseEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
    onClickCapture: (e: React.MouseEvent) => void;
  };
}

export function useContextMenuTrigger<T>(): ContextMenuTrigger<T> {
  const [menu, setMenu] = useState<(T & MenuPoint) | null>(null);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<MenuPoint | null>(null);
  const suppressUntilRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current != null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
  };
  useEffect(() => clearTimer, []);

  function bind(payload: T) {
    return {
      onContextMenu: (e: React.MouseEvent) => {
        // Suppress the NATIVE menu only on the element that owns this trigger;
        // the rest of the page keeps ordinary browser behaviour.
        e.preventDefault();
        clearTimer();
        suppressUntilRef.current = Date.now() + 400;
        setMenu({ ...payload, x: e.clientX, y: e.clientY });
      },
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0];
        if (!t || e.touches.length > 1) return;
        startRef.current = { x: t.clientX, y: t.clientY };
        clearTimer();
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          suppressUntilRef.current = Date.now() + 700;
          setMenu({ ...payload, x: startRef.current?.x ?? t.clientX, y: startRef.current?.y ?? t.clientY });
        }, LONG_PRESS_MS);
      },
      onTouchMove: (e: React.TouchEvent) => {
        const t = e.touches[0];
        const s = startRef.current;
        if (!t || !s) return;
        if (Math.abs(t.clientX - s.x) > MOVE_TOLERANCE_PX || Math.abs(t.clientY - s.y) > MOVE_TOLERANCE_PX) clearTimer();
      },
      onTouchEnd: clearTimer,
      onTouchCancel: clearTimer,
      onClickCapture: (e: React.MouseEvent) => {
        if (Date.now() < suppressUntilRef.current) { e.preventDefault(); e.stopPropagation(); }
      },
    };
  }

  return { menu, closeMenu: () => setMenu(null), bind };
}

/** Dismissal shared by every open menu: outside click, Escape, or any scroll. */
export function useDismissOnOutside(onClose: () => void): void {
  useEffect(() => {
    const close = () => onClose();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', close, true);
    };
  }, [onClose]);
}

/** Keep a fixed-position menu on screen. */
export function menuPosition(at: MenuPoint, width: number, height: number): { top: number; left: number } {
  return {
    top: Math.max(8, Math.min(at.y, window.innerHeight - height)),
    left: Math.max(8, Math.min(at.x, window.innerWidth - width)),
  };
}
