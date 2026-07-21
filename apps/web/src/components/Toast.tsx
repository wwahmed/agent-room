import { useEffect, useState } from 'react';

// T-46 rev2 (UX: an error toast wore the success check): outcome variants.
// Callers pass 'error' for failures; the icon and tone follow the outcome.
type ToastKind = 'success' | 'error';
interface ToastState { msg: string; kind: ToastKind }

let setGlobal: ((state: ToastState | null) => void) | null = null;

export function showToast(msg: string, kind: ToastKind = 'success') { setGlobal?.({ msg, kind }); }

// T-46: toasts are a live region (screen readers hear them without focus
// moving), hold long enough to actually read, and enter with the charter's
// single 150ms ease-out rise — guarded for reduced motion. Callers write the
// copy; the convention is that it says what happened or what to do next.
const TOAST_MS = 2_600;

export function ToastHost() {
  const [toast, setToast] = useState<ToastState | null>(null);
  useEffect(() => {
    setGlobal = setToast;
    return () => { setGlobal = null; };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  const error = toast.kind === 'error';
  return (
    <div
      role="status"
      aria-live="polite"
      className="toast-enter fixed bottom-5 right-5 z-[90] flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-[13px] font-medium text-surface shadow-elevated"
    >
      <div className={`flex h-4 w-4 items-center justify-center rounded-full text-surface ${error ? 'bg-danger' : 'bg-success'}`} aria-hidden="true">
        {error ? (
          <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3.5 8.5 3 3 6-7" />
          </svg>
        )}
      </div>
      {toast.msg}
    </div>
  );
}
