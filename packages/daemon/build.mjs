import { build } from 'esbuild';
import { chmodSync } from 'node:fs';
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'esnext',
  format: 'cjs',
  outfile: 'dist/cli.js',
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: 'inline',
  logLevel: 'info',
});
chmodSync('dist/cli.js', 0o755);
