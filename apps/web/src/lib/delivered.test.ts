import { describe, expect, it } from 'vitest';
import { deliveredAgents } from './delivered.js';

const NOW = 1_000_000;
const p = (name: string, over: Record<string, unknown> = {}) => ({
  name, client: 'cc' as const, ...over,
});

describe('T-20 deliveredAgents — truthful delivery lower bound', () => {
  it('an agent whose listen armed AFTER the message counts as delivered', () => {
    const rows = [p('A', { listenArmedAt: NOW + 5_000 }), p('B', { listenArmedAt: NOW - 1 })];
    expect(deliveredAgents(rows, NOW)).toEqual(['A']);
  });

  it('undercounts, never overclaims: same-instant arm and missing watermark do not count', () => {
    expect(deliveredAgents([p('A', { listenArmedAt: NOW })], NOW)).toEqual([]);
    expect(deliveredAgents([p('A')], NOW)).toEqual([]);
    expect(deliveredAgents(undefined, NOW)).toEqual([]);
  });

  it('web rows and viewers never appear', () => {
    const rows = [
      p('Human', { client: 'web', listenArmedAt: NOW + 5_000 }),
      p('Observer', { viewer: true, listenArmedAt: NOW + 5_000 }),
      p('Agent', { listenArmedAt: NOW + 5_000 }),
    ];
    expect(deliveredAgents(rows, NOW)).toEqual(['Agent']);
  });
});
