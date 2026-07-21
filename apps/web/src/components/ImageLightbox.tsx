import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MessageAttachment } from '@agent-room/shared';
import {
  IMAGE_ZOOM_MAX,
  IMAGE_ZOOM_MIN,
  clampImageZoom,
  imageViewerKeyAction,
  imageZoomAfter,
  imageZoomLabel,
  type ImageZoomAction,
} from '../lib/imageViewer.js';

interface Props {
  attachment: MessageAttachment;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ImageLightbox({ attachment, onClose }: Props) {
  const [zoom, setZoom] = useState(1);
  const titleId = useId();
  const statusId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const lastTapRef = useRef(0);

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      const zoomAction = imageViewerKeyAction(event.key);
      if (zoomAction) {
        event.preventDefault();
        setZoom(current => imageZoomAfter(current, zoomAction));
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocus?.focus();
    };
  }, [onClose]);

  function changeZoom(action: ImageZoomAction) {
    setZoom(current => imageZoomAfter(current, action));
  }

  function touchDistance(touches: React.TouchList): number {
    const first = touches.item(0);
    const second = touches.item(1);
    if (!first || !second) return 0;
    return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
  }

  function onTouchStart(event: React.TouchEvent) {
    if (event.touches.length !== 2) return;
    pinchRef.current = { distance: touchDistance(event.touches), zoom };
  }

  function onTouchMove(event: React.TouchEvent) {
    const pinch = pinchRef.current;
    if (!pinch || event.touches.length !== 2 || pinch.distance <= 0) return;
    event.preventDefault();
    setZoom(clampImageZoom(pinch.zoom * (touchDistance(event.touches) / pinch.distance)));
  }

  function onTouchEnd(event: React.TouchEvent) {
    const finishedPinch = Boolean(pinchRef.current);
    if (event.touches.length < 2) pinchRef.current = null;
    if (finishedPinch || event.touches.length > 0 || event.changedTouches.length !== 1) return;

    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      event.preventDefault();
      setZoom(current => current > 1 ? 1 : 2);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-xl sm:p-8"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={statusId}
        className="relative flex h-[calc(100dvh-2rem)] w-full max-w-[min(90rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/20 bg-neutral-950/90 text-white shadow-2xl sm:h-[calc(100dvh-4rem)]"
      >
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/15 px-3 py-2 sm:flex-nowrap sm:px-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-[14px] font-semibold">{attachment.name}</h2>
            <p className="mt-0.5 text-[12px] text-white/70">Pinch or double-tap to zoom</p>
            <span id={statusId} className="sr-only" aria-live="polite">Zoom {imageZoomLabel(zoom)}</span>
          </div>

          <a href={attachment.url} download={attachment.name} className="flex h-11 min-w-11 items-center justify-center rounded-lg border border-white/20 bg-white/10 px-3 text-[12px] font-semibold hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:order-2" aria-label={`Download ${attachment.name}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className="ml-2 hidden sm:inline">Download</span>
          </a>

          <button ref={closeButtonRef} type="button" onClick={onClose} className="flex h-11 min-w-11 items-center justify-center rounded-full bg-white text-neutral-950 shadow-lg hover:bg-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:order-3" aria-label="Close image viewer">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" /></svg>
          </button>

          <div className="order-last flex w-full shrink-0 items-center justify-center gap-1 sm:order-1 sm:w-auto" role="group" aria-label="Image zoom controls">
            <button type="button" onClick={() => changeZoom('out')} disabled={zoom <= IMAGE_ZOOM_MIN} className="flex h-11 min-w-11 items-center justify-center rounded-lg border border-white/20 bg-white/10 px-3 text-[14px] font-semibold hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-35" aria-label="Zoom out">−</button>
            <button type="button" onClick={() => changeZoom('reset')} disabled={zoom === 1} className="flex h-11 min-w-[4.5rem] items-center justify-center rounded-lg border border-white/20 bg-white/10 px-3 text-[12px] font-semibold tabular-nums hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50" aria-label={`Reset zoom, currently ${imageZoomLabel(zoom)}`}>{imageZoomLabel(zoom)}</button>
            <button type="button" onClick={() => changeZoom('in')} disabled={zoom >= IMAGE_ZOOM_MAX} className="flex h-11 min-w-11 items-center justify-center rounded-lg border border-white/20 bg-white/10 px-3 text-[14px] font-semibold hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-35" aria-label="Zoom in">+</button>
          </div>
        </header>

        <div
          className="min-h-0 flex-1 overflow-auto overscroll-contain"
          aria-label="Zoomed image; scroll to pan"
          style={{ touchAction: 'pan-x pan-y' }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={() => { pinchRef.current = null; }}
          onDoubleClick={() => setZoom(current => current > 1 ? 1 : 2)}
        >
          <div
            className="flex min-h-full min-w-full items-center justify-center p-4 sm:p-8"
            style={{
              height: `${Math.max(1, zoom) * 100}%`,
              width: `${Math.max(1, zoom) * 100}%`,
            }}
          >
            <img
              src={attachment.url}
              alt={attachment.name}
              draggable={false}
              className="max-h-[calc(100dvh-11rem)] max-w-[calc(100vw-4rem)] select-none object-contain transition-transform duration-150 ease-out motion-reduce:transition-none sm:max-h-[calc(100dvh-8rem)] sm:max-w-[calc(100vw-6rem)]"
              style={{ transform: `scale(${zoom})` }}
            />
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
