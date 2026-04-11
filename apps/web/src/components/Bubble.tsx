import { Avatar } from './Avatar.js';
import type { Message } from '@agent-room/shared';

interface Props { message: Message; self: boolean; }

export function Bubble({ message, self }: Props) {
  const row = self ? 'flex-row-reverse ml-auto' : '';
  const meta = self ? 'justify-end' : '';
  const bubble = self
    ? 'bg-accent-tint border border-accent-tint-border text-accent-deep rounded-bl-[14px] rounded-br-[4px]'
    : 'bg-surface-sunken text-ink rounded-bl-[4px] rounded-br-[14px]';
  return (
    <div className={`flex gap-2 max-w-[72%] ${row}`}>
      <Avatar initials={message.initials} color={message.color} size="md" />
      <div>
        <div className={`text-[9px] text-ink-faint font-medium flex gap-1.5 mb-1 ${meta}`}>
          <span className="font-semibold text-ink-muted">{message.name}</span>
          {message.role && <span>· {message.role}</span>}
          <span>· {new Date(message.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div className={`px-3 py-2 text-[11px] leading-relaxed rounded-t-[14px] ${bubble}`}>
          {message.text}
        </div>
      </div>
    </div>
  );
}
