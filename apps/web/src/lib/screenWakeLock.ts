export interface ScreenWakeLockSentinel {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

interface VisibilityDocument {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

interface ScreenWakeLockOptions {
  document?: VisibilityDocument | null;
  request?: (() => Promise<ScreenWakeLockSentinel>) | null;
}

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request(type: 'screen'): Promise<ScreenWakeLockSentinel> };
};

/**
 * Owns a screen wake lock for one active UI session. Wake Lock is deliberately
 * best-effort: unsupported browsers and request/release failures never affect
 * the feature that asked for it.
 */
export class ScreenWakeLockController {
  private readonly document: VisibilityDocument | null;
  private readonly request: (() => Promise<ScreenWakeLockSentinel>) | null;
  private sentinel: ScreenWakeLockSentinel | null = null;
  private sentinelReleaseListener: (() => void) | null = null;
  private requestInFlight = false;
  private active = false;
  private disposed = false;
  private generation = 0;

  constructor(options: ScreenWakeLockOptions = {}) {
    this.document = options.document === undefined
      ? (typeof document === 'undefined' ? null : document)
      : options.document;

    if (options.request !== undefined) {
      this.request = options.request;
    } else if (typeof navigator !== 'undefined') {
      const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
      this.request = wakeLock ? () => wakeLock.request('screen') : null;
    } else {
      this.request = null;
    }

    this.document?.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  setActive(active: boolean): void {
    if (this.disposed) return;
    this.active = active;
    if (active) {
      void this.acquire();
      return;
    }

    // Invalidates an asynchronous request that may finish after the session
    // stopped. Its sentinel is released immediately in acquire().
    this.generation += 1;
    void this.releaseCurrent();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.generation += 1;
    this.document?.removeEventListener('visibilitychange', this.onVisibilityChange);
    void this.releaseCurrent();
  }

  private readonly onVisibilityChange = (): void => {
    if (this.document?.visibilityState === 'visible') {
      if (this.active) void this.acquire();
      return;
    }

    // Browsers normally release screen locks when a page is hidden. Releasing
    // explicitly also closes the race where a pending request resolves late.
    this.generation += 1;
    void this.releaseCurrent();
  };

  private async acquire(): Promise<void> {
    if (
      this.disposed ||
      !this.active ||
      !this.request ||
      this.requestInFlight ||
      this.sentinel ||
      (this.document && this.document.visibilityState !== 'visible')
    ) return;

    const requestGeneration = this.generation;
    this.requestInFlight = true;
    let acquired: ScreenWakeLockSentinel | null = null;
    try {
      acquired = await this.request();
    } catch {
      // Unsupported, denied, or temporarily unavailable: dictation continues.
    } finally {
      this.requestInFlight = false;
    }

    if (!acquired) {
      // If this belonged to an older session, a fast stop/start may have begun
      // while it was pending. Retry for that newer session, but never loop on a
      // denial from the current generation.
      if (!this.disposed && this.active && requestGeneration !== this.generation) {
        void this.acquire();
      }
      return;
    }

    if (this.disposed || !this.active || requestGeneration !== this.generation) {
      try { await acquired.release(); } catch { /* best-effort cleanup */ }
      // The session may have become active again while the stale request was
      // resolving. Give that newer generation its own request.
      if (!this.disposed && this.active) void this.acquire();
      return;
    }

    this.sentinel = acquired;
    const onRelease = (): void => {
      if (this.sentinel !== acquired) return;
      acquired.removeEventListener('release', onRelease);
      this.sentinel = null;
      this.sentinelReleaseListener = null;
      if (this.active && this.document?.visibilityState === 'visible') {
        void this.acquire();
      }
    };
    this.sentinelReleaseListener = onRelease;
    acquired.addEventListener('release', onRelease);
  }

  private async releaseCurrent(): Promise<void> {
    const sentinel = this.sentinel;
    if (!sentinel) return;
    if (this.sentinelReleaseListener) {
      sentinel.removeEventListener('release', this.sentinelReleaseListener);
    }
    this.sentinel = null;
    this.sentinelReleaseListener = null;
    try { await sentinel.release(); } catch { /* best-effort cleanup */ }
  }
}
