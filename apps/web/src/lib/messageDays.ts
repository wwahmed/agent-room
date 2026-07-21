import type { Message } from '@agent-room/shared';

export function messageDayKey(time: number): string | null {
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function startsMessageDay(previous: Message | undefined, current: Message): boolean {
  const currentKey = messageDayKey(current.time);
  if (!currentKey) return false;
  const previousKey = previous ? messageDayKey(previous.time) : null;
  return !previousKey || previousKey !== currentKey;
}

export function messageDayLabel(time: number, now = Date.now()): string {
  const date = new Date(time);
  const today = new Date(now);
  if (!messageDayKey(time) || !messageDayKey(now)) return 'Date unavailable';
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (messageDayKey(time) === messageDayKey(now)) return 'Today';
  if (messageDayKey(time) === messageDayKey(yesterday.getTime())) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
