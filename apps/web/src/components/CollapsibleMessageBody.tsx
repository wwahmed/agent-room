import { useLayoutEffect, useRef, useState } from 'react';
import { MessageText } from './Bubble.js';

interface Props {
  text: string;
  selfName?: string;
}

export const COLLAPSED_MESSAGE_HEIGHT_PX = 372;

export function CollapsibleMessageBody({ text, selfName }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [collapsible, setCollapsible] = useState(false);

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
    <div>
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
          onClick={() => setExpanded(value => !value)}
          className="ui-focus-ring mt-2 min-h-11 rounded-control border border-border-subtle bg-surface-1 px-3 text-meta font-semibold text-ink-soft transition-colors duration-micro ease-product hover:border-border-strong hover:text-ink"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
