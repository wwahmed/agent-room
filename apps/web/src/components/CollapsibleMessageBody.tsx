import { useLayoutEffect, useRef, useState } from 'react';
import { MessageText } from './Bubble.js';
import { getScrollParent, markAnchoredMutation } from '../lib/readingAnchor.js';

interface Props {
  text: string;
  selfName?: string;
}

export const COLLAPSED_MESSAGE_HEIGHT_PX = 372;

export function CollapsibleMessageBody({ text, selfName }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // T-112: viewport-relative top of the toggle at the moment of the tap;
  // consumed by the layout effect below to hold the button in place.
  const anchorTopRef = useRef<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [collapsible, setCollapsible] = useState(false);

  // T-112 READING-ANCHOR RULE: after the expansion/contraction commits,
  // scroll the feed by exactly how far the tapped button moved, in the same
  // frame — the reader continues from the very next line, never losing their
  // place. Runs before the T-72 bottom-pin observer, which also yields to
  // anchored mutations via withinAnchoredMutation().
  useLayoutEffect(() => {
    const anchorTop = anchorTopRef.current;
    anchorTopRef.current = null;
    const button = buttonRef.current;
    if (anchorTop === null || !button) return;
    const scroller = getScrollParent(button);
    if (!scroller) return;
    const delta = button.getBoundingClientRect().top - anchorTop;
    if (delta !== 0) scroller.scrollTop += delta;
  }, [expanded]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setCollapsible(content.scrollHeight > COLLAPSED_MESSAGE_HEIGHT_PX + 2);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(content);
    return () => observer?.disconnect();
  }, [text]);

  return (
    // T-48 rev3: cap the markdown container itself. Capping only the parsed
    // paragraph/list children let the live MessageText path inherit the wider
    // bubble measure in practice. Attachments remain outside this component,
    // so images and other artifacts can still use the wider conversation pane.
    <div className="w-full max-w-[80ch]" data-message-prose-measure="80ch">
      <div
        className="overflow-hidden"
        style={{
          maxHeight: collapsible && !expanded ? COLLAPSED_MESSAGE_HEIGHT_PX : undefined,
          WebkitMaskImage: collapsible && !expanded
            ? 'linear-gradient(to bottom, #000 0, #000 calc(100% - 48px), transparent 100%)'
            : undefined,
        }}
      >
        <div ref={contentRef}>
          <MessageText text={text} selfName={selfName} />
        </div>
      </div>
      {collapsible && (
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            markAnchoredMutation();
            anchorTopRef.current = buttonRef.current?.getBoundingClientRect().top ?? null;
            setExpanded(value => !value);
          }}
          className="ui-focus-ring ml-auto mt-2 block min-h-11 rounded-control border border-border-subtle bg-surface-1 px-3 text-meta font-semibold text-ink-soft transition-colors duration-micro ease-product hover:border-border-strong hover:text-ink"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
