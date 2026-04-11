import { AVATAR_PALETTE } from '@agent-room/shared';

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function colorForName(name: string): string {
  const idx = hash(name) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[idx]!;
}

export function initialsFor(name: string): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  const one = parts[0]!;
  return (one.slice(0, 2)).toUpperCase().padEnd(2, '?');
}
