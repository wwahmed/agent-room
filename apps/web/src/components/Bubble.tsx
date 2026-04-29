import { Avatar } from './Avatar.js';
import { useMemo, type ReactNode } from 'react';
import type { Message } from '@agent-room/shared';

interface Props {
  message: Message;
  self: boolean;
  // When the same display name is held by multiple clients in the room (e.g.
  // "Robin · web" and "Robin · cc"), the parent passes the set of ambiguous
  // names so we can disambiguate by suffixing with the client kind.
  ambiguousNames?: Set<string>;
}

export function Bubble({ message, self, ambiguousNames }: Props) {
  const row = self ? 'flex-row-reverse ml-auto' : '';
  const meta = self ? 'justify-end' : '';
  const bubble = self
    ? 'bg-accent-tint border border-accent-tint-border text-accent-deep rounded-bl-[14px] rounded-br-[4px]'
    : 'bg-surface-sunken text-ink rounded-bl-[4px] rounded-br-[14px]';
  const ambiguous = ambiguousNames?.has(message.name);
  return (
    <div className={`flex gap-2 max-w-[min(640px,86%)] ${row}`}>
      <Avatar initials={message.initials} color={message.color} size="md" />
      <div className="min-w-0">
        <div className={`text-[9px] text-ink-faint font-medium flex gap-1.5 mb-1 ${meta}`}>
          <span className="font-semibold text-ink-muted">{message.name}</span>
          {ambiguous && <span className="text-ink-faint">· {message.client}</span>}
          {message.role && <span>· {message.role}</span>}
          <span>· {new Date(message.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div className={`px-3 py-2 text-[13px] leading-relaxed rounded-t-[14px] break-words ${bubble}`}>
          <MessageText text={message.text} />
        </div>
      </div>
    </div>
  );
}

function MessageText({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);

  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          return (
            <pre key={index} className="overflow-x-auto rounded-lg bg-ink text-white/90 px-3 py-2 text-[11px] leading-relaxed">
              <code>{block.lines.join('\n')}</code>
            </pre>
          );
        }

        if (block.type === 'list') {
          const ordered = block.items.every(item => /^\d+[.)]\s+/.test(item));
          const ListTag = ordered ? 'ol' : 'ul';
          return (
            <ListTag key={index} className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1`}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item.replace(/^(\d+[.)]|[-*•])\s+/, ''))}</li>
              ))}
            </ListTag>
          );
        }

        if (block.type === 'heading') {
          return (
            <div key={index} className="font-semibold text-[13px] text-current">
              {renderInline(block.text.replace(/^#{1,3}\s*/, ''))}
            </div>
          );
        }

        return (
          <p key={index} className="whitespace-pre-wrap">
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}

type TextBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; lines: string[] };

function parseBlocks(text: string): TextBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: TextBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    const text = paragraph.join('\n').trim();
    if (text) blocks.push({ type: 'paragraph', text });
    paragraph = [];
  }

  function flushList() {
    if (list.length === 0) return;
    blocks.push({ type: 'list', items: list });
    list = [];
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (code) {
        blocks.push({ type: 'code', lines: code });
        code = null;
      } else {
        flushParagraph();
        flushList();
        code = [];
      }
      continue;
    }

    if (code) {
      code.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^#{1,3}\s+/.test(line.trim())) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', text: line.trim() });
      continue;
    }

    if (/^\s*(?:[-*•]|\d+[.)])\s+/.test(line)) {
      flushParagraph();
      list.push(line.trim());
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  if (code) blocks.push({ type: 'code', lines: code });

  return blocks.length ? blocks : [{ type: 'paragraph', text }];
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|https?:\/\/[^\s]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));

    const value = match[0];
    if (value.startsWith('`')) {
      nodes.push(
        <code key={nodes.length} className="rounded bg-black/10 px-1 py-0.5 text-[.92em]">
          {value.slice(1, -1)}
        </code>,
      );
    } else if (value.startsWith('**')) {
      nodes.push(<strong key={nodes.length}>{value.slice(2, -2)}</strong>);
    } else {
      const trailing = value.match(/[.,;:!?)\]"']+$/)?.[0] ?? '';
      const href = trailing ? value.slice(0, -trailing.length) : value;
      nodes.push(
        <a key={nodes.length} href={href} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
          {href}
        </a>,
      );
      if (trailing) nodes.push(trailing);
    }

    lastIndex = match.index + value.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
