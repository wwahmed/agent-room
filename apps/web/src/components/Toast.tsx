import { useEffect, useState } from 'react';

let setGlobal: ((msg: string | null) => void) | null = null;

export function showToast(msg: string) { setGlobal?.(msg); }

// T-46: toasts are a live region (screen readers hear them without focus
// moving), hold long enough to actually read, and enter with the charter's
// single 150ms ease-out rise — guarded for reduced motion. Callers write the
// copy; the convention is that it says what happened or what to do next.
const TOAST_MS = 2_600;

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    setGlobal = setMsg;
    return () => { setGlobal = null; };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="toast-enter fixed bottom-5 right-5 z-[90] flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-[13px] font-medium text-surface shadow-elevated"
    >
      <div className="flex h-4 w-4 items-center justify-center rounded-full bg-success text-surface" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m3.5 8.5 3 3 6-7" />
        </svg>
      </div>
      {msg}
    </div>
  );
}
