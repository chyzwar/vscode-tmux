import { build } from 'esbuild';
import { chmodSync } from 'node:fs';
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'esnext',
  format: 'esm',
  outfile: 'dist/cli.mjs',
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: 'inline',
  logLevel: 'info',
});
chmodSync('dist/cli.mjs', 0o755);
