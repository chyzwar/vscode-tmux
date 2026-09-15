import { build } from 'esbuild';
import { rmSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true });
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
