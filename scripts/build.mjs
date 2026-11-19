import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('artifacts', { recursive: true });
await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  legalComments: 'inline',
});
