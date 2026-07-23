import { describe, it, expect } from 'vitest';
import { filterSlashCommands, SLASH_COMMANDS } from './slashCommands.js';

describe('filterSlashCommands', () => {
  it('opens on a leading "/" with every command', () => {
    const all = filterSlashCommands('/');
    expect(all.length).toBe(SLASH_COMMANDS.length);
    expect(all.some((c) => c.label === '/brief')).toBe(true);
    expect(all.every((c) => c.hint.length > 0)).toBe(true);
  });
  it('narrows to the audio command on "/brief-w"', () => {
    const m = filterSlashCommands('/brief-w');
    expect(m.map((c) => c.insert)).toEqual(['/brief-with-audio']);
  });
  it('narrows to deep on "/brief d"', () => {
    expect(filterSlashCommands('/brief d').map((c) => c.label)).toEqual(['/brief deep']);
  });
  it('does NOT open on a mid-string slash (and/or, URLs)', () => {
    expect(filterSlashCommands('and/or')).toEqual([]);
    expect(filterSlashCommands('see http://x/y')).toEqual([]);
    expect(filterSlashCommands('hello')).toEqual([]);
  });
  it('closes once the user is typing a topic argument', () => {
    expect(filterSlashCommands('/brief payments')).toEqual([]);
  });
  it('still offers deep and <topic> right after "/brief "', () => {
    const labels = filterSlashCommands('/brief ').map((c) => c.label);
    expect(labels).toContain('/brief <topic>');
    expect(labels).toContain('/brief deep');
  });
});
