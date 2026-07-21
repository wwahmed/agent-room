// T-71 rev19 item 2: EXACTLY one arrival effect per jump. When scrollend
// wins, the fallback timer is CLEARED; when the fallback wins, the listener
// is REMOVED — neither path can double-flash or extend the accepted 2s.

interface FlashTarget { classList: { add(c: string): void; remove(c: string): void } }
interface ScrollHost {
  addEventListener(type: string, fn: () => void, opts?: { once?: boolean }): void;
  removeEventListener(type: string, fn: () => void): void;
}

export function armArrivalFlash(
  el: FlashTarget,
  feed: ScrollHost | null,
  supportsScrollend: boolean,
  flashMs = 2000,
  fallbackMs = 2500,
): void {
  let done = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  const finish = () => {
    if (done) return;
    done = true;
    if (fallbackTimer != null) clearTimeout(fallbackTimer);
    if (feed) feed.removeEventListener('scrollend', finish);
    el.classList.add('reply-flash');
    setTimeout(() => el.classList.remove('reply-flash'), flashMs);
  };
  if (feed && supportsScrollend) {
    feed.addEventListener('scrollend', finish, { once: true });
    fallbackTimer = setTimeout(finish, fallbackMs);
  } else {
    setTimeout(finish, 800);
  }
}
