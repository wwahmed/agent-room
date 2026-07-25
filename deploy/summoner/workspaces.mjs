// workspaces.mjs — enumerate ALL local workspaces, grouped nicely, for the
// Summon picker. Dynamic (reads the filesystem each call) so it's always current.
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ROOTS = [join(homedir(), 'workspaces')];

function groupOf(name) {
  const n = name.toLowerCase();
  if (n.startsWith('agent-room')) return 'Agent Room (v1 / chat)';
  if (n === 'agent-tower') return 'Quorum (v2)';
  if (n.includes('3dbypixel') || n === '3d-utils' || n.includes('manager3dbypixel')) return '3dByPixel';
  if (n === 'wakilabs' || n.includes('brain') || n.startsWith('waki')) return 'WakiLabs / Brain';
  return 'Other / Tools';
}

const GROUP_ORDER = [
  'Agent Room (v1 / chat)',
  'Quorum (v2)',
  '3dByPixel',
  'WakiLabs / Brain',
  'Other / Tools',
];

function describe(path) {
  const git = existsSync(join(path, '.git'));
  const pkg = existsSync(join(path, 'package.json'));
  return { git, pkg };
}

// Returns [{ group, items: [{ name, path, git, pkg }] }] in a stable order.
export function listGrouped() {
  const seen = new Set();
  const byGroup = new Map();
  for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    let entries = [];
    try { entries = readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const d of entries) {
      if (!d.isDirectory()) continue;
      if (d.name.startsWith('.')) continue; // skip .claude, .wrangler, etc.
      const path = join(root, d.name);
      if (seen.has(path)) continue;
      try { if (!statSync(path).isDirectory()) continue; } catch { continue; }
      seen.add(path);
      const g = groupOf(d.name);
      const meta = describe(path);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push({ name: d.name, path, ...meta });
    }
  }
  const groups = [];
  const orderedNames = [...GROUP_ORDER, ...[...byGroup.keys()].filter((g) => !GROUP_ORDER.includes(g))];
  for (const g of orderedNames) {
    const items = byGroup.get(g);
    if (!items || !items.length) continue;
    items.sort((a, b) => a.name.localeCompare(b.name));
    groups.push({ group: g, items });
  }
  return groups;
}

// Flat set of valid workspace paths (for validating a summon request).
export function validWorkspacePaths() {
  const set = new Set();
  for (const g of listGrouped()) for (const it of g.items) set.add(it.path);
  return set;
}
