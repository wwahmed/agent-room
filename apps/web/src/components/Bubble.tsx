import { Avatar } from './Avatar.js';
import { useMemo, type ReactNode } from 'react';
import type { Message, MessageAttachment } from '@agent-room/shared';
import { normalizeEscapedWhitespace } from '@agent-room/shared';

interface Props {
  message: Message;
  self: boolean;
  // When the same display name is held by multiple clients in the room (e.g.
  // "Robin · web" and "Robin · cc"), the parent passes the set of ambiguous
  // names so we can disambiguate by suffixing with the client kind.
  ambiguousNames?: Set<string>;
}

export function Bubble({ message, self, ambiguousNames }: Props) {
  if (message.type === 'sys') {
    return (
      <div className="mx-auto max-w-[min(620px,92%)] rounded-full border border-border-faint bg-surface px-3 py-1.5 text-center text-[12px] font-semibold text-ink-soft shadow-sm">
        {systemEventLabel(message)}
      </div>
    );
  }

  // WhatsApp-style: own messages right-aligned in a solid accent bubble with no
  // avatar; everyone else left-aligned with an avatar and a colored name inside
  // the bubble. The squared-off corner (rounded-*-sm) is the tail.
  const ambiguous = ambiguousNames?.has(message.name);
  const time = new Date(message.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const bubble = self
    ? 'bg-accent text-white rounded-2xl rounded-br-sm'
    : 'bg-surface text-ink rounded-2xl rounded-bl-sm';

  return (
    <div className={`flex w-full gap-2 ${self ? 'flex-row-reverse' : ''}`}>
      {!self && <Avatar initials={message.initials} color={message.color} size="md" />}
      <div className={`min-w-0 max-w-[85%] sm:max-w-[min(640px,75%)] px-3 py-2 shadow-sm break-words [overflow-wrap:anywhere] ${bubble}`}>
        {!self && (
          <div className="mb-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[12px] leading-tight">
            <span className="font-semibold" style={{ color: message.color }}>{message.name}</span>
            {ambiguous && <span className="text-ink-faint">· {message.client}</span>}
            {message.role && <span className="text-ink-faint">· {message.role}</span>}
          </div>
        )}
        <div className="text-[15px] leading-relaxed">
          {message.text.trim() && <MessageText text={message.text} />}
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
        </div>
        <div className={`mt-1 text-[11px] leading-none text-right ${self ? 'text-white/70' : 'text-ink-faint'}`}>
          {time}
        </div>
      </div>
    </div>
  );
}

function systemEventLabel(message: Message): string {
  const eventType = message.metadata?.eventType;
  const target = message.metadata?.targetAgentName ? `@${message.metadata.targetAgentName}` : '';
  if (eventType === 'mode_changed') {
    const mode = message.metadata?.modeAtSend;
    return mode ? `Reply mode changed to ${mode}` : message.text;
  }
  if (eventType === 'timed_out' && target) return `${target} timed out and was skipped`;
  if (eventType === 'skipped_by_host' && target) return `${target} was skipped by host`;
  if (eventType === 'skipped_by_grace' && target) return `${target} was preempted by supplement (lead grace elapsed)`;
  if (eventType === 'host_invoked' && target) return `${target} was asked by host`;
  if (eventType === 'moderator_dispatched' && target) return `${target} was assigned by moderator`;
  if (eventType === 'lead_left' && target) return `${target} left. Switched to Open mode`;
  if (eventType === 'moderator_left' && target) return `${target} left. Switched to Open mode`;
  if (eventType === 'moderator_fallback') return 'Moderator unavailable. Switched to Open mode';
  return message.text;
}

function AttachmentList({ attachments }: { attachments: MessageAttachment[] }) {
  return (
    <div className="mt-2 space-y-2">
      {attachments.map(attachment => (
        attachment.type === 'image'
          ? <ImageAttachment key={attachment.id} attachment={attachment} />
          : <FileAttachment key={attachment.id} attachment={attachment} />
      ))}
    </div>
  );
}

function ImageAttachment({ attachment }: { attachment: MessageAttachment }) {
  return (
    <div className="overflow-hidden rounded-lg border border-black/10 bg-black/5">
      <a href={attachment.url} target="_blank" rel="noreferrer" className="block">
        <img src={attachment.url} alt={attachment.name} className="max-h-64 w-full object-contain" />
      </a>
      <div className="flex items-center justify-between gap-2 border-t border-black/10 px-2 py-1.5 text-[10px]">
        <div className="min-w-0">
          <div className="truncate font-semibold">{attachment.name}</div>
          <div className="opacity-60">{formatBytes(attachment.size)} · {fileTypeLabel(attachment)}</div>
        </div>
        <AttachmentActions attachment={attachment} />
      </div>
    </div>
  );
}

function FileAttachment({ attachment }: { attachment: MessageAttachment }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-black/10 bg-black/5 px-3 py-2 text-[11px]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface/70 font-bold text-[10px] text-ink-muted">
        {fileTypeLabel(attachment)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{attachment.name}</div>
        <div className="opacity-60">{formatBytes(attachment.size)} · {attachment.mime}</div>
      </div>
      <AttachmentActions attachment={attachment} />
    </div>
  );
}

function AttachmentActions({ attachment }: { attachment: MessageAttachment }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <a
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        className="rounded-md border border-black/10 bg-surface/70 px-2 py-1 font-semibold hover:bg-surface"
      >
        Open
      </a>
      <a
        href={attachment.url}
        download={attachment.name}
        className="rounded-md bg-ink px-2 py-1 font-semibold text-white hover:bg-ink-soft"
      >
        Download
      </a>
    </div>
  );
}

function fileTypeLabel(attachment: MessageAttachment): string {
  const name = attachment.name.toLowerCase();
  const mime = attachment.mime.toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'PDF';
  if (mime === 'text/html' || name.endsWith('.html') || name.endsWith('.htm')) return 'HTML';
  if (mime === 'text/csv' || name.endsWith('.csv')) return 'CSV';
  if (mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel' || name.endsWith('.xlsx') || name.endsWith('.xls')) return 'XLS';
  if (mime.includes('wordprocessingml') || name.endsWith('.docx')) return 'DOC';
  if (mime.startsWith('image/')) return 'IMG';
  if (mime === 'application/zip' || name.endsWith('.zip')) return 'ZIP';
  if (mime === 'application/json' || name.endsWith('.json')) return 'JSON';
  if (mime === 'text/markdown' || name.endsWith('.md')) return 'MD';
  if (mime.startsWith('text/') || name.endsWith('.txt')) return 'TXT';
  return 'FILE';
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function MessageText({ text }: { text: string }) {
  // Defensively unescape literal `\n` / `\t` sequences before parsing —
  // some agent clients (Cursor's Composer is the documented offender)
  // double-escape multi-line bodies before passing them as the `text` arg
  // to room_send. The MCP server now normalizes on the way in, but
  // historical messages in active rooms predate that fix; running the
  // same normalization here at render time makes them readable too.
  // No-op for well-formed text, see normalizeEscapedWhitespace JSDoc.
  const blocks = useMemo(() => parseBlocks(normalizeEscapedWhitespace(text)), [text]);

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

// Inline patterns recognized inside a paragraph/list-item:
//   `code`           — monospace
//   **bold**         — strong
//   https://...      — autolinked
//   [DECISION] x     — chip-style artifact marker (also TODO / STATUS / RESULT)
// The artifact marker chip mirrors extractArtifacts, which recognizes markers
// anywhere on a message line.
const INLINE_PATTERN = /(\[(?:DECISION|TODO|STATUS|RESULT)\])|(`[^`]+`|\*\*[^*]+\*\*|https?:\/\/[^\s]+)/gi;

// Dark-theme tones: translucent tint + light text, so the chips read on a dark
// bubble instead of glaring as light blocks.
const ARTIFACT_TONE: Record<string, string> = {
  DECISION: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30',
  TODO:     'bg-amber-500/15 text-amber-300 ring-amber-400/30',
  STATUS:   'bg-blue-500/15 text-blue-300 ring-blue-400/30',
  RESULT:   'bg-violet-500/15 text-violet-300 ring-violet-400/30',
};

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_PATTERN.lastIndex = 0;

  while ((match = INLINE_PATTERN.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));

    const artifactMarker = match[1];
    const value = match[2] ?? artifactMarker ?? match[0];

    if (artifactMarker) {
      const kind = artifactMarker.slice(1, -1).toUpperCase();
      const tone = ARTIFACT_TONE[kind] ?? 'bg-black/10 text-current ring-black/10';
      nodes.push(
        <span
          key={nodes.length}
          className={`inline-flex items-center rounded-md px-1.5 py-0.5 mr-1 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset ${tone}`}
        >
          {kind}
        </span>,
      );
    } else if (value.startsWith('`')) {
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

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
