import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWebReleaseSnapshot } from './webReleaseSnapshot.js';

const roots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'wakichat-web-release-'));
  roots.push(root);
  mkdirSync(join(root, 'assets'));
  writeFileSync(
    join(root, 'index.html'),
    '<script type="module" src="/assets/index-OLD123.js"></script>'
      + '<link rel="stylesheet" href="/assets/index-OLD123.css">',
  );
  writeFileSync(join(root, 'assets', 'index-OLD123.js'), 'old javascript');
  writeFileSync(join(root, 'assets', 'index-OLD123.css'), 'old css');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('immutable web release snapshot', () => {
  it('keeps serving the exact boot bytes after WEB_DIST is replaced', () => {
    const root = fixture();
    const release = loadWebReleaseSnapshot(root, 'server-old');
    const originalId = release.release;

    writeFileSync(
      join(root, 'index.html'),
      '<script type="module" src="/assets/index-NEW456.js"></script>',
    );
    writeFileSync(join(root, 'assets', 'index-OLD123.js'), 'mutated in place');
    writeFileSync(join(root, 'assets', 'index-NEW456.js'), 'new javascript');

    expect(release.bundle).toBe('OLD123');
    expect(release.release).toBe(originalId);
    expect(release.asset('/')?.bytes.toString()).toContain('index-OLD123.js');
    expect(release.asset('/r/hail-cow-dart')?.bytes.toString()).toContain('index-OLD123.js');
    expect(release.asset('/assets/index-OLD123.js')?.bytes.toString()).toBe('old javascript');
    expect(release.asset('/assets/index-NEW456.js')).toBeUndefined();
  });

  it('includes server and every web file in the release fingerprint', () => {
    const root = fixture();
    const initial = loadWebReleaseSnapshot(root, 'server-a');
    const changedServer = loadWebReleaseSnapshot(root, 'server-b');
    writeFileSync(join(root, 'assets', 'index-OLD123.css'), 'changed css');
    const changedAsset = loadWebReleaseSnapshot(root, 'server-a');

    expect(initial.release).not.toBe(changedServer.release);
    expect(initial.release).not.toBe(changedAsset.release);
    expect(initial.release).toMatch(/^[a-f0-9]{64}$/);
    expect(initial.fileCount).toBe(3);
    expect(initial.totalBytes).toBeGreaterThan(0);
  });

  it('fails startup when index.html names a missing hashed asset', () => {
    const root = fixture();
    rmSync(join(root, 'assets', 'index-OLD123.js'));

    expect(() => loadWebReleaseSnapshot(root, 'server-a'))
      .toThrow('references missing asset: /assets/index-OLD123.js');
  });

  it('fails closed on symlinks inside WEB_DIST', () => {
    const root = fixture();
    symlinkSync(join(root, 'assets', 'index-OLD123.js'), join(root, 'assets', 'alias.js'));

    expect(() => loadWebReleaseSnapshot(root, 'server-a'))
      .toThrow('WEB_DIST may not contain symlinks');
  });

  it('404s unknown files instead of returning the SPA shell', () => {
    const release = loadWebReleaseSnapshot(fixture(), 'server-a');

    expect(release.asset('/assets/missing.js')).toBeUndefined();
    expect(release.asset('/sw.js')).toBeUndefined();
    expect(release.asset('/settings')?.bytes.toString()).toContain('index-OLD123.js');
  });
});
