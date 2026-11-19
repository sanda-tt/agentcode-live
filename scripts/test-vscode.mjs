import { runTests } from '@vscode/test-electron';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = await mkdtemp(join(tmpdir(), 'agentcode-vscode-'));
const roots = ['demo', 'secondary'];
const workspace = join(temp, 'agentcode.code-workspace');
try {
  for (const root of roots) await mkdir(join(temp, root));
  await writeFile(join(temp, 'demo', '.gitignore'), 'ignored.c\n');
  await writeFile(join(temp, 'demo', 'existing.c'), 'int seed(void) { return 0; }\n');
  await writeFile(workspace, JSON.stringify({
    folders: roots.map(path => ({ path })),
    settings: {
      'workbench.startupEditor': 'none',
      'telemetry.telemetryLevel': 'off',
      'agentcodeLive.maxFileKiB': 32,
      'agentcodeLive.ignore': ['local-ignore.c'],
    },
  }));
  await runTests({
    version: '1.100.3',
    vscodeExecutablePath: process.env.AGENTCODE_VSCODE,
    reuseMachineInstall: true,
    extensionDevelopmentPath: resolve('.'),
    extensionTestsPath: resolve('build/tests/vscode.js'),
    extensionTestsEnv: { AGENTCODE_NODE: process.execPath },
    launchArgs: [workspace, '--user-data-dir', join(temp, 'user'), '--extensions-dir', join(temp, 'extensions'),
      '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
      ...(process.env.CI && process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []),
      ...(process.env.AGENTCODE_GUI_PORT ? ['--remote-debugging-port=' + process.env.AGENTCODE_GUI_PORT] : [])],
  });
} finally {
  await rm(temp, { recursive: true, force: true, maxRetries: 2 });
}
