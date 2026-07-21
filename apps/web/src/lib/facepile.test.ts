import { describe, expect, it } from 'vitest';
import {
  facepileLabel,
  facepileSeverity,
  facepileTooltip,
  facepileWindow,
  isStaleState,
  type AgentFace,
} from './facepile.js';

const face = (name: string, state: AgentFace['state']): AgentFace => ({
  name,
  color: '#123456',
  initials: name.slice(0, 2).toUpperCase(),
  state,
});

describe('facepileSeverity', () => {
  it('is healthy only with zero stale agents', () => {
    expect(facepileSeverity(3, 0)).toBe('healthy');
    expect(facepileSeverity(3, 1)).toBe('degraded');
    expect(facepileSeverity(3, 3)).toBe('down');
    expect(facepileSeverity(1, 1)).toBe('down');
  });
});

describe('facepileWindow', () => {
  it('caps at three circles total: 2 avatars + chip when overflowing (R1)', () => {
    const faces = [face('A', 'listening'), face('B', 'online'), face('C', 'online'), face('D', 'stale')];
    const { visible, overflow } = facepileWindow(faces, 6);
    expect(visible).toHaveLength(2);
    expect(overflow).toBe(4); // 6 real agents, 2 avatar circles + one "+4" chip
  });

  it('shows three plain avatars when exactly three agents', () => {
    const faces = [face('A', 'listening'), face('B', 'online'), face('C', 'online')];
    const { visible, overflow } = facepileWindow(faces, 3);
    expect(visible).toHaveLength(3);
    expect(overflow).toBe(0);
  });

  it('has no overflow when everyone fits', () => {
    const { visible, overflow } = facepileWindow([face('A', 'listening')], 1);
    expect(visible).toHaveLength(1);
    expect(overflow).toBe(0);
  });
});

describe('wording', () => {
  it('words severity instead of relying on color', () => {
    expect(facepileLabel(2, 0)).toBe('2 agents, all responding. Open People panel.');
    expect(facepileLabel(2, 1)).toBe('2 agents, 1 needs attention. Open People panel.');
    expect(facepileLabel(2, 2)).toBe('2 agents, none responding. Open People panel.');
    expect(facepileLabel(1, 0)).toBe('1 agent, all responding. Open People panel.');
  });

  it('tooltip mirrors the same verdicts in short form', () => {
    expect(facepileTooltip(3, 0)).toBe('3 agents · all responding');
    expect(facepileTooltip(3, 2)).toBe('2 of 3 agents need attention');
    expect(facepileTooltip(3, 3)).toBe('3 agents · none responding');
  });
});

describe('isStaleState', () => {
  it('treats stale and disconnected as needing attention', () => {
    expect(isStaleState('listening')).toBe(false);
    expect(isStaleState('online')).toBe(false);
    expect(isStaleState('stale')).toBe(true);
    expect(isStaleState('disconnected')).toBe(true);
  });
});
