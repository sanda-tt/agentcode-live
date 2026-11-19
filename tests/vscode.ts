import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as vscode from 'vscode';
import { getDiff, type Activity } from '../src/core';

type Api = {
  events(): Activity[];
  whenReady(): Promise<void>;
  decoration(uri: vscode.Uri): vscode.FileDecoration | undefined;
  connectDsh(): Promise<string>;
  runCodex(root: string, prompt: string): Promise<void>;
};

async function until<T>(label: string, find: () => T | undefined | false, timeout = 12000): Promise<T> {
  const deadline = Date.now() + timeout;
  do {
    const result = find();
    if (result) return result;
    await delay(45);
  } while (Date.now() < deadline);
  throw new Error('Timed out: ' + label);
}

export async function run() {
  const extension = vscode.extensions.getExtension<Api>('sanda-tt.agentcode-live')!;
  assert.ok(extension);
  const api = await extension.activate();
  const [primary, secondary] = vscode.workspace.workspaceFolders!;
  const root = primary.uri.fsPath;
  const file = (name: string) => join(root, name);
  const uri = (name: string) => vscode.Uri.file(file(name));
  const event = (name: string, type: string, after?: string) => api.events().findLast(item =>
    item.fileUri === uri(name).toString() && item.eventType === type &&
    item.source === 'filesystem' && (after === undefined || item.after === after),
  );
  const wait = (name: string, type: string, after?: string) => until(type + ' ' + name, () => event(name, type, after));
  const settings = vscode.workspace.getConfiguration('agentcodeLive');
  await api.whenReady();
  // Ensure the native watcher is attached before the first external write.
  await delay(650);
  const seed = 'int seed(void) { return 1; }\n';
  await writeFile(file('existing.c'), seed);
  assert.equal((await wait('existing.c', 'modified', seed)).before, 'int seed(void) { return 0; }\n');

  const before = Array.from({ length: 30 }, (_, index) => 'int f' + index + '(void) { return ' + index + '; }\n').join('');
  await writeFile(file('demo.c'), before);
  const created = await wait('demo.c', 'created', before);
  assert.equal(getDiff(created).added, 30);
  assert.equal(api.decoration(uri('demo.c'))?.badge, 'N');
  assert.equal(created.agentId, 'Unknown');
  const after = before.trimEnd().split('\n').slice(10).map((line, i) => i < 5 ? line.replace('return ', 'return 100 + ') : line).join('\n') + '\n';
  await writeFile(file('demo.c'), after);
  const modified = await wait('demo.c', 'modified', after);
  assert.deepEqual([getDiff(modified).added, getDiff(modified).removed], [5, 15]);
  assert.equal(api.decoration(uri('demo.c'))?.badge, 'M');
  await vscode.commands.executeCommand('agentcodeLive.preview', modified);
  assert.ok(vscode.workspace.textDocuments.some(document => document.uri.scheme === 'agentcode-live' && document.getText() === before));
  assert.ok(vscode.workspace.textDocuments.some(document => document.uri.scheme === 'agentcode-live' && document.getText() === after));
  await vscode.commands.executeCommand('agentcodeLive.timeline');
  await vscode.commands.executeCommand('agentcodeLive.cinematic', modified);
  await delay(400);
  assert.equal(await readFile(file('demo.c'), 'utf8'), after);

  const appended = after + 'int extra(void) { return 1; }\n';
  await appendFile(file('demo.c'), appended.slice(after.length));
  assert.equal(getDiff(await wait('demo.c', 'modified', appended)).added, 1);
  const inserted = 'int inserted(void) { return 2; }\n' + after;
  await writeFile(file('demo.c'), inserted);
  assert.deepEqual(getDiff(await wait('demo.c', 'modified', inserted)).blocks.filter(block => block.kind !== 'same').map(block => block.kind),
    ['add', 'remove']);
  await writeFile(file('demo.tmp'), 'int atom(void) { return 7; }\n');
  await rename(file('demo.tmp'), file('demo.c'));
  await wait('demo.c', 'modified', 'int atom(void) { return 7; }\n');
  await rename(file('demo.c'), file('moved.c'));
  const moved = await wait('moved.c', 'renamed');
  assert.equal(moved.oldFileUri, uri('demo.c').toString());
  assert.equal(moved.provenance, 'inferred');
  await rm(file('moved.c'));
  const deleted = await wait('moved.c', 'deleted');
  assert.equal(deleted.after, null);
  assert.equal(api.decoration(uri('moved.c')), undefined);

  await mkdir(file('nested'));
  await writeFile(file('nested/.gitignore'), '*.txt\n');
  const excluded = ['ignored.c', 'local-ignore.c', '.env.local', 'binary.c', 'large.c', 'nested/ignored.txt'];
  const excludedContents = ['ignored', 'ignored', 'SECRET', Buffer.from([0, 23, 40]), 'A'.repeat(33000), 'ignored'];
  await Promise.all(excluded.map((name, index) => writeFile(file(name), excludedContents[index])));
  const count = Number(process.env.AGENTCODE_BURST_FILES ?? 35);
  const cpu = process.cpuUsage();
  const memory = process.memoryUsage().rss;
  const start = performance.now();
  await Promise.all(Array.from({ length: count }, (_, index) => writeFile(file('batch-' + index + '.c'), 'int batch;\n')));
  const secondaryFile = join(secondary.uri.fsPath, 'other.c');
  await writeFile(secondaryFile, 'int other;\n');
  await until('secondary root', () => api.events().find(item => item.fileUri === vscode.Uri.file(secondaryFile).toString()));
  await until('burst complete', () => api.events().filter(item => item.fileUri?.includes('/batch-')).length === count);
  assert.ok(excluded.every(name => !api.events().some(item => item.fileUri === uri(name).toString())));
  const spent = process.cpuUsage(cpu);
  console.log(JSON.stringify({ fixture: 'vscode-burst', files: count, wallMs: Math.round(performance.now() - start),
    extensionHostCpuMs: Math.round((spent.system + spent.user) / 1000), extensionHostRssDeltaBytes: process.memoryUsage().rss - memory }));

  for (let index = 0; index < 16; index++) await writeFile(file('rapid.c'), 'int n = ' + index + ';\n');
  await until('rapid final state', () => api.events().some(item => item.fileUri === uri('rapid.c').toString() && item.after === 'int n = 15;\n'));
  await settings.update('enabled', false, vscode.ConfigurationTarget.Workspace);
  await delay(240);
  await writeFile(file('pause-setting.c'), 'int disabled;\n');
  await delay(250);
  assert.equal(event('pause-setting.c', 'created'), undefined);
  await settings.update('enabled', true, vscode.ConfigurationTarget.Workspace);
  await delay(350);
  await api.whenReady();
  await writeFile(file('pause-setting.c'), 'int enabled;\n');
  await wait('pause-setting.c', 'modified', 'int enabled;\n');

  if (process.env.AGENTCODE_TEST_CODEX === '1') {
    const cli = process.env.AGENTCODE_CODEX ?? 'codex';
    await settings.update('codexExecutable', cli, vscode.ConfigurationTarget.Global);
    const prompt = 'In this isolated fixture, use apply_patch to create observer-codex.c containing exactly: int from_codex(void) { return 11; } with a trailing newline. Do not edit other files.';
    await runProcess(cli, ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', prompt], root);
    const observed = await wait('observer-codex.c', 'created');
    assert.match(observed.after!, /return 11;/u);
    await runProcess('git', ['init', '-q'], root);
    await api.runCodex(root, 'Create managed-codex.c with this single C line: int managed(void) { return 12; } . Prefer the apply_patch tool. Do not edit other files.');
    await wait('managed-codex.c', 'created');
    await until('native Codex file change', () => api.events().find(item =>
      item.source === 'codex' && item.provenance === 'native' && item.fileUri === uri('managed-codex.c').toString() && item.nativePatch), 35000);
    await until('native Codex turn completion', () => api.events().find(item =>
      item.source === 'codex' && item.eventType === 'turn' && item.status === 'completed'), 90000);
    assert.ok(api.events().some(item => item.source === 'codex' && item.eventType === 'diff'));
    await vscode.commands.executeCommand('agentcodeLive.codexStop');
  }

  if (process.env.AGENTCODE_DSH_CLI && process.env.AGENTCODE_DSH_TOOLS) {
    const fixture = resolve(__dirname, '../../tests/fixtures/dsh-tool.mjs');
    const overlay = join(root, '..', 'dsh-test.yml');
    const bundle = resolve(__dirname, '../../packages/dsh-plugin/index.js');
    await writeFile(overlay, '- insert:\n    - id: agentcode-observer\n      name: ' + JSON.stringify(bundle.replaceAll('\\', '/')) +
      '\n    - id: agentcode-acceptance\n      name: ' + JSON.stringify(fixture.replaceAll('\\', '/')) + '\n');
    const descriptor = await api.connectDsh();
    for (let index = 0; index < 2; index++) {
      const written = 'dsh-' + index + '.c';
      const child = spawn(process.env.AGENTCODE_NODE!, [process.env.AGENTCODE_DSH_CLI, 'web', '--patch', overlay,
        '--no-open', '--host', '127.0.0.1', '--port', '0'], {
        cwd: root, windowsHide: true,
        env: { ...process.env, DSH_HOME: join(root, '..', 'dsh'), AGENTCODE_LIVE_DSH_DESCRIPTOR: descriptor,
          AGENTCODE_DSH_DEMO_FILE: file(written) },
      });
      let logs = '';
      child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-14000); });
      child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-14000); });
      try {
        await until('official DSH Web listening', () => /dsh web: http/u.test(logs), 30000);
        await wait(written, 'created');
        await until('actual Cordis tool result forwarded', () => api.events().filter(item =>
          item.source === 'dsh' && item.label === 'agentcode_acceptance_write' && item.status === 'completed').length > index, 14000);
      } catch (error) {
        throw new Error(String(error) + '\n' + logs.replace(/([?&]token=)[^\s]+/gu, '$1[redacted]'));
      } finally {
        const closed = new Promise(resolve => child.once('close', resolve));
        child.kill();
        await closed;
      }
      await until('DSH disconnect detected', () => api.events().filter(item =>
        item.source === 'dsh' && item.status === 'disconnected').length > index, 22000);
    }
  }

  if (process.env.AGENTCODE_GUI_PORT) {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('agentcodeLive.activity.focus');
    await vscode.commands.executeCommand('agentcodeLive.timeline');
    console.log('AgentCode Live GUI is ready for inspection.');
    await delay(Number(process.env.AGENTCODE_GUI_WAIT_MS ?? 25000));
  }
  console.log('AgentCode Live Extension Development Host assertions passed.');
}

async function runProcess(executable: string, args: string[], cwd: string) {
  const child = spawn(executable, args, {
    cwd, windowsHide: true, signal: AbortSignal.timeout(120000),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  child.stdout.resume();
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-3500); });
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error('CLI exit ' + code + '\n' + diagnostics)));
  });
}
