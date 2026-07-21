import type { Message } from '@agent-room/shared';

export function messageDayKey(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function startsMessageDay(previous: Message | undefined, current: Message): boolean {
  return !previous || messageDayKey(previous.time) !== messageDayKey(current.time);
}

export function messageDayLabel(time: number, now = Date.now()): string {
  const date = new Date(time);
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (messageDayKey(time) === messageDayKey(now)) return 'Today';
  if (messageDayKey(time) === messageDayKey(yesterday.getTime())) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
