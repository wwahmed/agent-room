import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/projects.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  sourcemap: false,
  // Bundle workspace packages (their package.json main points at TS source,
  // which Node can't load directly) so dist/index.js is self-contained.
  noExternal: ['@agent-room/shared', '@agent-room/upstash-client'],
});
