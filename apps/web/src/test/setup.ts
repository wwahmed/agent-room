import { beforeEach } from 'vitest';

// Portable Web Storage for tests. Newer Node versions predefine
// `globalThis.localStorage` (undefined unless Node's own webstorage flag is
// on), and vitest's jsdom population skips globals that already exist, so
// whether bare `localStorage` works depends on the runner's Node version.
// Install a real spec-shaped storage explicitly so every environment —
// node or jsdom, any Node version, no flags — sees the same object.
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null; }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
}

function install(name: 'localStorage' | 'sessionStorage'): Storage {
  const storage = new MemoryStorage();
  for (const target of new Set<object>([globalThis, typeof window === 'undefined' ? globalThis : window])) {
    Object.defineProperty(target, name, { value: storage, writable: true, configurable: true });
  }
  return storage;
}

const local = install('localStorage');
const session = install('sessionStorage');

// jsdom ships neither matchMedia nor the observers; screen-level DOM tests
// (Room bootstrap transitions) need inert, deterministic versions.
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }),
    });
  }
  for (const name of ['ResizeObserver', 'IntersectionObserver']) {
    if (!(name in globalThis)) {
      Object.defineProperty(globalThis, name, {
        writable: true,
        configurable: true,
        value: class { observe() {} unobserve() {} disconnect() {} },
      });
    }
  }
}

beforeEach(() => {
  local.clear();
  session.clear();
});
