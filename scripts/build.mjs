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
await build({
  entryPoints: ['media/timeline.js'],
  outfile: 'dist/webview/timeline.js',
  bundle: true,
  target: 'chrome132',
  minify: true,
  legalComments: 'inline',
});
