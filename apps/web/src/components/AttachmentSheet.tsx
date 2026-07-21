import { useEffect, useRef } from 'react';

// T-80 (P0): the attachment chooser must DISMISS reliably. The old inline
// popover's only close path ran inside addFiles, so tapping elsewhere or
// cancelling the native picker stranded it open (host repro 52245). This
// component owns every exit: explicit Cancel, backdrop/outside tap, Escape,
// Android Back (pushed history entry + popstate), and CLOSE-BEFORE-NATIVE
// ordering so a cancelled OS picker returns to a composer with no sheet.
// Phone <=639px renders a real bottom sheet (backdrop, title, 56px rows,
// safe area, inert background); desktop keeps a deliberate anchored dialog.

interface Props {
  open: boolean;
  onClose: () => void;
  onPickImages: () => void;
  onPickFiles: () => void;
  /** The paperclip trigger; focus returns here on every close path. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
}

const BACK_STATE = 'wakichat:attachment-sheet';
let openNonce = 0;

export function AttachmentSheet({ open, onClose, onPickImages, onPickFiles, returnFocusRef }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const firstRowRef = useRef<HTMLButtonElement>(null);
  // Distinguishes "closed by Back" (history already popped) from every other
  // close (our pushed entry must be consumed so Back stays predictable).
  const poppedRef = useRef(false);
  // Room re-renders continuously (polling) and recreates its callbacks, so
  // the lifecycle effect must depend ONLY on `open` — with onClose in its
  // deps it re-armed every render, churning push/back history pairs and
  // re-stealing focus the whole time the sheet was up.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const returnFocusRefRef = useRef(returnFocusRef);
  returnFocusRefRef.current = returnFocusRef;

  useEffect(() => {
    if (!open) return;
    poppedRef.current = false;
    // Per-open nonce: history.back() is ASYNC, so a rapid close-and-reopen
    // could otherwise let the OLD close's back() pop the NEW open's entry
    // and silently dismiss the fresh sheet. Cleanup only consumes an entry
    // it can prove is its own.
    const nonce = ++openNonce;
    try { window.history.pushState({ [BACK_STATE]: nonce }, ''); } catch { /* sandboxed */ }
    const onPop = () => { poppedRef.current = true; onCloseRef.current(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    const onPointer = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    firstRowRef.current?.focus();
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      if (!poppedRef.current) {
        try {
          if ((window.history.state as Record<string, unknown> | null)?.[BACK_STATE] === nonce) window.history.back();
        } catch { /* sandboxed */ }
      }
      returnFocusRefRef.current.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  // Ordering is the load-bearing fix: the sheet is GONE before the native
  // picker opens, so an OS-level cancel cannot resurrect or strand it.
  const pick = (launch: () => void) => {
    onClose();
    launch();
  };

  const row =
    'flex min-h-14 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] font-semibold text-ink transition sm:min-h-11 sm:text-sm';

  return (
    <>
      {/* Phone backdrop: inert background, tap = exit. */}
      <div className="fixed inset-0 z-40 bg-black/50 sm:hidden" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add attachment"
        className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-surface p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-full sm:left-0 sm:z-30 sm:mb-2 sm:w-56 sm:rounded-xl sm:border sm:p-1.5"
      >
        <div className="px-3 pb-1 pt-2 text-[13px] font-semibold text-ink-faint sm:pt-1">Add attachment</div>
        <button ref={firstRowRef} type="button" onClick={() => pick(onPickImages)} className={`${row} hover:bg-accent-tint`}>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-tint text-accent" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="2.5" width="12" height="11" rx="2"/><circle cx="5.5" cy="6" r="1.2"/><path d="m3.5 12 3.2-3 2.1 1.8 1.5-1.4 2.2 2.6"/></svg>
          </span>
          Photos & images
        </button>
        <button type="button" onClick={() => pick(onPickFiles)} className={`${row} hover:bg-surface-softer`}>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-softer text-ink-soft" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 1.8h5l3 3V14H4z"/><path d="M9 1.8V5h3"/></svg>
          </span>
          Files & documents
        </button>
        <div className="my-1 h-px bg-border-faint sm:hidden" aria-hidden="true" />
        <button type="button" onClick={onClose} className={`${row} justify-center text-ink-soft hover:bg-surface-softer sm:hidden`}>
          Cancel
        </button>
      </div>
    </>
  );
}
