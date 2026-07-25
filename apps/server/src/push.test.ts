import { describe, expect, it } from 'vitest';
import {
  isTeammateMessage,
  normalizeNotifyLevel,
  parseNotifyPrefs,
  readPushEnv,
  shouldNotifyOwner,
  shouldSuppressAllPush,
  upsertSubscription,
  READING_WINDOW_MS,
  type StoredSubscription,
} from './push.js';

// T-118: owner notification channel — dispatch predicate and subscription
// bookkeeping.
describe('owner push predicate (T-118)', () => {
  const names = ['Waqas'];

  it('fires on @mentions and bare name mentions, case-insensitive', () => {
    expect(shouldNotifyOwner({ text: 'ping @Waqas please review', name: 'Claude' }, names)).toBe(true);
    expect(shouldNotifyOwner({ text: 'waqas should decide the order', name: 'Claude' }, names)).toBe(true);
    expect(shouldNotifyOwner({ text: 'Ping @WAQAS!', name: 'Claude' }, names)).toBe(true);
  });

  it('fires on question artifacts addressed to the owner', () => {
    expect(shouldNotifyOwner({ text: '', name: 'Codex', metadata: { eventType: 'question_created', questionId: 'q1' } as never }, names)).toBe(true);
  });

  it('stays quiet on ordinary traffic, partial-word hits, and the owner speaking', () => {
    expect(shouldNotifyOwner({ text: 'deploying the hotfix now', name: 'Claude' }, names)).toBe(false);
    expect(shouldNotifyOwner({ text: 'the waqasine compound is unrelated', name: 'Claude' }, names)).toBe(false);
    expect(shouldNotifyOwner({ text: 'I, Waqas, approve', name: 'Waqas' }, names)).toBe(false);
    expect(shouldNotifyOwner({ text: '', name: 'Claude' }, names)).toBe(false);
  });
});

describe('subscription bookkeeping (T-118)', () => {
  const sub = (endpoint: string): StoredSubscription => ({ endpoint, keys: { p256dh: 'k', auth: 'a' }, addedAt: 1 });

  it('replaces a re-registered endpoint instead of duplicating it', () => {
    const merged = upsertSubscription([sub('https://a'), sub('https://b')], { endpoint: 'https://a', keys: { p256dh: 'k2', auth: 'a2' } }, 99);
    expect(merged).toHaveLength(2);
    const a = merged.find(s => s.endpoint === 'https://a')!;
    expect(a.addedAt).toBe(99);
    expect(a.keys.p256dh).toBe('k2');
  });
});

describe('notify level (T-118 all-messages mode)', () => {
  it('normalizes anything unrecognized to mentions', () => {
    expect(normalizeNotifyLevel('all')).toBe('all');
    expect(normalizeNotifyLevel('mentions')).toBe('mentions');
    expect(normalizeNotifyLevel('ALL')).toBe('mentions');
    expect(normalizeNotifyLevel(undefined)).toBe('mentions');
    expect(normalizeNotifyLevel(42)).toBe('mentions');
  });

  it('parses stored prefs defensively', () => {
    expect(parseNotifyPrefs('{"level":"all"}')).toBe('all');
    expect(parseNotifyPrefs('{"level":"mentions"}')).toBe('mentions');
    expect(parseNotifyPrefs(null)).toBe('mentions');
    expect(parseNotifyPrefs('not json')).toBe('mentions');
    expect(parseNotifyPrefs('{"level":"shout"}')).toBe('mentions');
  });
});

describe('all-level teammate predicate (T-118 all-messages mode)', () => {
  const names = ['Waqas'];

  it('fires on ordinary teammate chat messages', () => {
    expect(isTeammateMessage({ text: 'deploying the hotfix now', name: 'Claude' }, names)).toBe(true);
  });

  it('stays quiet on status rows, empty text, and the owner speaking', () => {
    expect(isTeammateMessage({ text: 'working…', name: 'Claude', metadata: { kind: 'status' } as never }, names)).toBe(false);
    expect(isTeammateMessage({ text: '', name: 'Claude' }, names)).toBe(false);
    expect(isTeammateMessage({ text: '   ', name: 'Claude' }, names)).toBe(false);
    expect(isTeammateMessage({ text: 'my own note', name: 'Waqas' }, names)).toBe(false);
    expect(isTeammateMessage({ text: 'my own note', name: 'WAQAS' }, names)).toBe(false);
  });
});

describe('suppress-when-reading (T-118 all-messages mode)', () => {
  const now = 10_000_000;

  it('suppresses when caught up and the marker moved inside the window', () => {
    expect(shouldSuppressAllPush({ markerCount: 41, markerMovedAt: now - 5_000, totalAfterAppend: 42, now })).toBe(true);
    expect(shouldSuppressAllPush({ markerCount: 42, markerMovedAt: now - READING_WINDOW_MS, totalAfterAppend: 42, now })).toBe(true);
  });

  it('delivers when the reader is behind', () => {
    expect(shouldSuppressAllPush({ markerCount: 40, markerMovedAt: now - 5_000, totalAfterAppend: 42, now })).toBe(false);
  });

  it('delivers when the marker went stale', () => {
    expect(shouldSuppressAllPush({ markerCount: 41, markerMovedAt: now - READING_WINDOW_MS - 1, totalAfterAppend: 42, now })).toBe(false);
  });

  it('delivers on missing data — suppression must be earned', () => {
    expect(shouldSuppressAllPush({ markerCount: null, markerMovedAt: now, totalAfterAppend: 42, now })).toBe(false);
    expect(shouldSuppressAllPush({ markerCount: 41, markerMovedAt: null, totalAfterAppend: 42, now })).toBe(false);
    expect(shouldSuppressAllPush({ markerCount: 41, markerMovedAt: now, totalAfterAppend: null, now })).toBe(false);
  });
});

describe('push env (T-118)', () => {
  it('disables cleanly without keys and reads owner config with them', () => {
    expect(readPushEnv({} as NodeJS.ProcessEnv)).toBe(null);
    const env = readPushEnv({ VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 's', OWNER_NOTIFY_NAMES: 'Waqas, WA' } as unknown as NodeJS.ProcessEnv)!;
    expect(env.ownerNames).toEqual(['Waqas', 'WA']);
    expect(env.ownerEmail).toBe('wwahmed@gmail.com');
  });
});
