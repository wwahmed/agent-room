// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_MODES,
  AGENT_MODE_COPY,
  MAX_AGENT_MODE,
  defaultAgentMode,
  isAgentMode,
  setDefaultAgentMode,
} from './agentDefaults.js';

const KEY = 'wakichat:summon:default-mode';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('default agent permissions', () => {
  it('defaults to MAXIMUM so a fresh summon does not prompt its way through the job', () => {
    expect(defaultAgentMode()).toBe('build');
    expect(MAX_AGENT_MODE).toBe('build');
  });

  it('honours a level the owner chose', () => {
    setDefaultAgentMode('edit');
    expect(defaultAgentMode()).toBe('edit');
    setDefaultAgentMode('chat');
    expect(defaultAgentMode()).toBe('chat');
  });

  // Every bad read must land on the documented default rather than silently
  // reverting to the chat-only behaviour the host asked us to stop doing.
  it.each([
    ['an unknown value', 'superuser'],
    ['an empty string', ''],
    ['a number', '3'],
    ['JSON', '{"mode":"build"}'],
  ])('falls back to maximum for %s', (_label, stored) => {
    localStorage.setItem(KEY, stored);
    expect(defaultAgentMode()).toBe('build');
  });

  it('falls back to maximum when storage throws', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('disabled'); });
    expect(defaultAgentMode()).toBe('build');
  });

  it('refuses to persist a junk level instead of storing it', () => {
    setDefaultAgentMode('root' as never);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => setDefaultAgentMode('chat')).not.toThrow();
  });

  it('announces a change so an already-open summon sheet is not stale', () => {
    const seen: string[] = [];
    const onChange = (e: Event) => seen.push((e as CustomEvent<{ mode: string }>).detail.mode);
    window.addEventListener('wakichat:agent-mode', onChange);
    setDefaultAgentMode('edit');
    window.removeEventListener('wakichat:agent-mode', onChange);
    expect(seen).toEqual(['edit']);
  });

  it('validates levels', () => {
    expect(AGENT_MODES).toEqual(['chat', 'edit', 'build']);
    for (const mode of AGENT_MODES) expect(isAgentMode(mode)).toBe(true);
    for (const bad of [null, undefined, '', 'BUILD', 'admin', 7]) expect(isAgentMode(bad)).toBe(false);
  });

  it('describes every level, and says out loud what maximum costs', () => {
    for (const mode of AGENT_MODES) {
      expect(AGENT_MODE_COPY[mode].title.length).toBeGreaterThan(0);
      expect(AGENT_MODE_COPY[mode].detail.length).toBeGreaterThan(0);
    }
    // The default must not be sold as free — the reach is stated where it is chosen.
    expect(AGENT_MODE_COPY.build.detail).toMatch(/without prompting/);
    expect(AGENT_MODE_COPY.build.detail).toMatch(/blast radius/i);
  });
});
