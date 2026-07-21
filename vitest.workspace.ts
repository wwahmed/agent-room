// Root-invocation safety: without this file, `npx vitest run <paths>` from
// the repo root uses a bare default config and BYPASSES each package's own
// test config — notably apps/web's setupFiles storage shim — so the same
// suite passes from apps/web and fails from the root. This workspace file
// makes a root invocation resolve every package through its local config.
export default ['apps/*', 'packages/*'];
