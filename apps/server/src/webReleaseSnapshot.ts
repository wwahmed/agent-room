import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { extname, join, posix, relative, sep } from 'node:path';

export interface WebReleaseAsset {
  bytes: Buffer;
  sha256: string;
}

export interface WebReleaseSnapshot {
  root: string;
  bundle: string;
  release: string;
  server: string;
  totalBytes: number;
  fileCount: number;
  asset(urlPath: string): WebReleaseAsset | undefined;
}

const INDEX_PATH = '/index.html';
const ENTRY_BUNDLE_RE = /(?:^|\/)assets\/index-([A-Za-z0-9_-]+)\.js(?:["'?#]|$)/;
const LOCAL_ASSET_RE = /(?:src|href)=["'](\/assets\/[^"'?#]+)(?:[?#][^"']*)?["']/g;

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function keyForRelativePath(path: string): string {
  return `/${path.split(sep).join('/')}`;
}

function resolveAssetKey(urlPath: string): string | null {
  if (!urlPath || urlPath === '/') return INDEX_PATH;
  if (urlPath.includes('\u0000')) return null;

  // This lookup never touches the filesystem, but normalizing still makes the
  // routing contract explicit and prevents aliases such as /a/../assets/x.js.
  const normalized = posix.normalize(`/${urlPath.replaceAll('\\', '/')}`);
  if (normalized === '/' || extname(normalized) === '') return INDEX_PATH;
  return normalized;
}

/**
 * Read the complete built web application once, before the HTTP listener opens.
 *
 * A running process must serve one coherent release. Replacing WEB_DIST on
 * disk while the process is alive cannot change its index, hashed assets, or
 * /api/version response; only an intentional server restart can advance them.
 */
export function loadWebReleaseSnapshot(
  configuredRoot: string,
  serverBuildId: string,
): WebReleaseSnapshot {
  const root = realpathSync(configuredRoot);
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`WEB_DIST is not a directory: ${configuredRoot}`);
  }

  const files = new Map<string, WebReleaseAsset>();
  let totalBytes = 0;

  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error(`WEB_DIST may not contain symlinks: ${absolute}`);
      }
      if (stat.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`WEB_DIST contains unsupported entry: ${absolute}`);
      }

      const key = keyForRelativePath(relative(root, absolute));
      const bytes = readFileSync(absolute);
      files.set(key, { bytes, sha256: sha256(bytes) });
      totalBytes += bytes.byteLength;
    }
  }

  walk(root);

  const index = files.get(INDEX_PATH);
  if (!index) throw new Error(`WEB_DIST is missing ${INDEX_PATH}`);
  const indexHtml = index.bytes.toString('utf8');
  const bundle = indexHtml.match(ENTRY_BUNDLE_RE)?.[1] ?? 'unknown';
  if (bundle === 'unknown') {
    throw new Error('WEB_DIST index.html has no hashed entry bundle');
  }

  for (const match of indexHtml.matchAll(LOCAL_ASSET_RE)) {
    const path = match[1];
    if (!files.has(path)) {
      throw new Error(`WEB_DIST index.html references missing asset: ${path}`);
    }
  }

  const manifest = [...files.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, asset]) => `${path}\t${asset.sha256}`)
    .join('\n');
  const release = sha256(`server\t${serverBuildId}\n${manifest}`);

  return {
    root,
    bundle,
    release,
    server: serverBuildId,
    totalBytes,
    fileCount: files.size,
    asset(urlPath: string) {
      const key = resolveAssetKey(urlPath);
      return key ? files.get(key) : undefined;
    },
  };
}
