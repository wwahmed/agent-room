import { describe, expect, it } from 'vitest';
import { readPushEnv, shouldNotifyOwner, upsertSubscription, type StoredSubscription } from './push.js';

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

describe('push env (T-118)', () => {
  it('disables cleanly without keys and reads owner config with them', () => {
    expect(readPushEnv({} as NodeJS.ProcessEnv)).toBe(null);
    const env = readPushEnv({ VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 's', OWNER_NOTIFY_NAMES: 'Waqas, WA' } as unknown as NodeJS.ProcessEnv)!;
    expect(env.ownerNames).toEqual(['Waqas', 'WA']);
    expect(env.ownerEmail).toBe('wwahmed@gmail.com');
  });
});
