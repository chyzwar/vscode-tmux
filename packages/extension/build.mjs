import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'esnext',
  format: 'cjs',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: 'inline',
  logLevel: 'info',
});
mkdirSync('dist', { recursive: true });
copyFileSync('../daemon/dist/cli.mjs', 'dist/cli.mjs');
