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
  const containerRef = useRef<HTMLDivElement>(null);
  // T-112 rev2: viewport-relative top of the CONTENT CONTAINER at the moment
  // of the tap. The container top fixes the read/unread boundary (the last
  // visible line of the collapsed preview sits at container top + collapsed
  // height), so holding the container still keeps the reader's place while
  // the revealed text continues below it. The button is deliberately NOT the
  // anchor — pinning it forced the reveal to open above the reading line
  // (the defect Waqas's before/after frames showed); it travels down with
  // the new end of the message.
  const anchorTopRef = useRef<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [collapsible, setCollapsible] = useState(false);

  // T-112 READING-ANCHOR RULE: after the expansion/contraction commits,
  // scroll the feed by exactly how far the content container moved, in the
  // same frame — the last line read stays put and the reader continues onto
  // the newly revealed text. Runs before the T-72 bottom-pin observer, which
  // also yields to anchored mutations via withinAnchoredMutation().
  useLayoutEffect(() => {
    const anchorTop = anchorTopRef.current;
    anchorTopRef.current = null;
    const container = containerRef.current;
    if (anchorTop === null || !container) return;
    const scroller = getScrollParent(container);
    if (!scroller) return;
    const delta = container.getBoundingClientRect().top - anchorTop;
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
    <div ref={containerRef} className="w-full max-w-[80ch]" data-message-prose-measure="80ch">
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
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            markAnchoredMutation();
            anchorTopRef.current = containerRef.current?.getBoundingClientRect().top ?? null;
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
