import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@agent-room/shared';
import {
  browserSendIntent,
  clearPendingBrowserSend,
  newClientSendId,
  readPendingBrowserSend,
  writePendingBrowserSend,
} from './sendOutbox.js';

const storage = new Map<string, string>();
const localStorageStub = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
};

describe('browser send outbox', () => {
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', localStorageStub);
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_, i) => { bytes[i] = i; });
        return bytes;
      },
    });
  });

  it('creates a stable 32-hex send id', () => {
    expect(newClientSendId()).toBe('000102030405060708090a0b0c0d0e0f');
  });

  it('persists and reloads the exact message and intent', () => {
    const intent = browserSendIntent({ text: 'hello', dictated: false });
    const message: Message = {
      id: 1, type: 'msg', name: 'A', role: '', initials: 'AA', color: '#000',
      client: 'web', text: 'hello', time: 1,
      metadata: { clientSendId: 'a'.repeat(32) },
    };
    writePendingBrowserSend('room-a', 'A', intent, message);
    expect(readPendingBrowserSend('room-a', 'A')).toMatchObject({ intent, message });
  });

  it('clears only the matching send id', () => {
    const intent = browserSendIntent({ text: 'hello', dictated: false });
    const message: Message = {
      id: 1, type: 'msg', name: 'A', role: '', initials: 'AA', color: '#000',
      client: 'web', text: 'hello', time: 1,
      metadata: { clientSendId: 'b'.repeat(32) },
    };
    writePendingBrowserSend('room-a', 'A', intent, message);
    clearPendingBrowserSend('room-a', 'A', 'c'.repeat(32));
    expect(readPendingBrowserSend('room-a', 'A')).not.toBeNull();
    clearPendingBrowserSend('room-a', 'A', 'b'.repeat(32));
    expect(readPendingBrowserSend('room-a', 'A')).toBeNull();
  });
});
