// Root-invocation safety: without this file, `npx vitest run <paths>` from
// the repo root uses a bare default config and BYPASSES each package's own
// test config — notably apps/web's setupFiles storage shim — so the same
// suite passes from apps/web and fails from the root. This workspace file
// makes a root invocation resolve every package through its local config.
//
// The scripts/ vitest suites (visual gate rules/report) live outside any
// package, so they get their own explicit project. room-health and the
// memberkey proxy tests are node:test files run by `npm test` directly and
// stay out of vitest.
export default [
  'apps/*',
  'packages/*',
  {
    test: {
      name: 'scripts',
      include: ['scripts/visual-gate-assertions.test.mjs', 'scripts/visual-gate-report.test.mjs', 'scripts/visual-gate.integration.test.mjs'],
    },
  },
];
