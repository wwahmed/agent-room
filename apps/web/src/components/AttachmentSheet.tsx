import { useEffect, useRef } from 'react';

// T-80 (P0): the attachment chooser must DISMISS reliably. The old inline
// popover's only close path ran inside addFiles, so tapping elsewhere or
// cancelling the native picker stranded it open (host repro 52245).
//
// Architecture (design lead ruling): a real native <dialog> via showModal(),
// NOT a hand-rolled role=dialog with document listeners and a pushed-history
// sentinel. The native top layer gives inert background, focus containment,
// Escape, and the Chrome/Android close-request (Back) behavior for free, and
// it cannot pollute the room's back stack. Outside taps land on ::backdrop
// (the dialog element itself), so the paperclip never receives the same
// gesture and the open-toggle can never instantly reopen it (VA-0069).
// Photos/Files call dialog.close() SYNCHRONOUSLY, then the native input
// click runs in the SAME user-gesture stack — no await, no history
// traversal, so an OS-level cancel returns to a composer with no sheet.
// Phone <=639px styles the dialog as a bottom sheet; desktop anchors it
// above the paperclip.

interface Props {
  open: boolean;
  onClose: () => void;
  onPickImages: () => void;
  onPickFiles: () => void;
  /** The paperclip trigger; anchors the desktop surface and receives focus
   *  back on every close path. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
}

export function AttachmentSheet({ open, onClose, onPickImages, onPickFiles, returnFocusRef }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Room re-renders continuously (polling) and recreates its callbacks, so
  // the lifecycle effect depends ONLY on `open`; callbacks flow through refs.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const returnFocusRefRef = useRef(returnFocusRef);
  returnFocusRefRef.current = returnFocusRef;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    // Desktop: anchored surface above the trigger. Phone: CSS bottom sheet.
    if (window.innerWidth >= 640) {
      const rect = returnFocusRefRef.current.current?.getBoundingClientRect();
      if (rect) {
        dialog.style.left = `${Math.round(rect.left)}px`;
        dialog.style.bottom = `${Math.round(window.innerHeight - rect.top + 8)}px`;
        dialog.style.top = 'auto';
      }
    } else {
      dialog.style.left = '';
      dialog.style.bottom = '';
      dialog.style.top = '';
    }
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', ''); // jsdom without dialog support
    }
    return () => {
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
      returnFocusRefRef.current.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  // dialog.close() leaves the top layer SYNCHRONOUSLY; the native input
  // click that follows runs in the same user-gesture stack.
  const pick = (launch: () => void) => {
    const dialog = dialogRef.current;
    if (dialog?.open && typeof dialog.close === 'function') dialog.close();
    onCloseRef.current();
    launch();
  };

  const row =
    'flex min-h-14 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] font-semibold text-ink transition sm:min-h-11 sm:text-sm';

  return (
    <dialog
      ref={dialogRef}
      aria-label="Add attachment"
      onCancel={() => onCloseRef.current()}
      onClose={() => onCloseRef.current()}
      onClick={event => {
        // Only the ::backdrop region reports the dialog element itself as
        // target (the padded inner div covers the panel), so inside taps
        // can never dismiss.
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
      className="attachment-sheet fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none rounded-t-2xl border-t border-border bg-surface p-0 text-ink shadow-2xl sm:inset-x-auto sm:w-56 sm:rounded-xl sm:border"
    >
      <div className="p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-1.5">
        <div className="px-3 pb-1 pt-2 text-[13px] font-semibold text-ink-faint sm:pt-1">Add attachment</div>
        <button type="button" onClick={() => pick(onPickImages)} className={`${row} hover:bg-accent-tint`}>
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
        <button type="button" onClick={() => onCloseRef.current()} className={`${row} justify-center text-ink-soft hover:bg-surface-softer sm:hidden`}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
