import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const staging = await mkdtemp(join(tmpdir(), 'agentcode-dsh-package-'));
const destination = resolve('artifacts');
try {
  await mkdir(destination, { recursive: true });
  for (const entry of ['package.json', 'index.js', 'changes.js', 'client.js', 'README.md', 'cordis.patch.yml']) {
    await copyFile(join('packages', 'dsh-plugin', entry), join(staging, entry));
  }
  await copyFile('LICENSE', join(staging, 'LICENSE'));
  execFileSync(process.execPath, [process.env.npm_execpath, 'pack', staging, '--pack-destination', destination], { stdio: 'inherit' });
} finally {
  await rm(staging, { recursive: true, force: true });
}
