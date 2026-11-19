import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const cli = process.env.AGENTCODE_DSH_CLI;
const executablePath = process.env.AGENTCODE_CHROME;
assert.ok(cli && executablePath, 'Set AGENTCODE_DSH_CLI and AGENTCODE_CHROME to the installed CLI entry and Chrome binary.');
const { version } = JSON.parse(await readFile('packages/dsh-plugin/package.json', 'utf8'));
const archive = resolve('artifacts', 'dsh-agentcode-live-' + version + '.tgz').replaceAll('\\', '/');
const fixture = resolve('tests/fixtures/dsh-panel.mjs').replaceAll('\\', '/');
const temp = await mkdtemp(join(tmpdir(), 'agentcode-web-test-'));
const cwd = join(temp, 'workspace');
const overlay = join(temp, 'overlay.yml');
const key = randomUUID();
let child;
let browser;
let logs = '';

// Use the official custom-provider configuration with a test-only loopback
// provider. The browser opens without any external DSH account or model call.
const provider = createServer((request, response) => {
  if (request.headers.authorization !== 'Bearer ' + key) {
    response.writeHead(401).end();
  } else if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'fixture-model', object: 'model' }] }));
  } else {
    response.writeHead(404).end();
  }
});

try {
  await mkdir(cwd);
  await new Promise((ready, reject) => {
    provider.once('error', reject);
    provider.listen(0, '127.0.0.1', ready);
  });
  const env = { ...process.env, DSH_HOME: join(temp, 'dsh'), AGENTCODE_DSH_PANEL_ROOT: cwd,
    AGENTCODE_FIXTURE_PROVIDER_KEY: key };
  const exec = args => execFileSync(process.execPath, [cli, ...args], { cwd, env, timeout: 30000 });
  exec(['agentcode-panel', '--from-default-profile', 'web', '--dump-config']);
  exec(['plugin', '--profile', 'agentcode-panel', 'add', archive]);
  await writeFile(overlay, [
    '- insert:', '    - id: agentcode-web-fixture', '      name: ' + JSON.stringify(fixture),
    '- id: llm-pi-ai', '  config:', '    providers:', '      agentcode-fixture:',
    '        apiKeyEnv: AGENTCODE_FIXTURE_PROVIDER_KEY', '        api: openai-completions',
    '        baseURL: http://127.0.0.1:' + provider.address().port + '/v1',
    '        models:', '          - id: fixture-model', '',
  ].join('\n'));
  child = spawn(process.execPath, [cli, 'agentcode-panel', '--patch', overlay, '--no-open',
    '--host', '127.0.0.1', '--port', '0'], { cwd, env, windowsHide: true });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
  let url;
  let sessionId;
  for (let retry = 0; retry < 80; retry++) {
    url = /dsh web: (http:\/\/127\.0\.0\.1:[^\s]+)/u.exec(logs)?.[1];
    sessionId = await readFile(join(cwd, 'ready'), 'utf8').catch(() => undefined);
    if (url && sessionId || child.exitCode !== null || logs.includes('Web fixture failed')) break;
    await delay(300);
  }
  assert.ok(url && sessionId, 'DSH Web and its isolated Session start');
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1320, height: 860 } });
  await page.goto(url);
  const notice = page.getByRole('button', { name: /^(Continue|继续)$/u });
  await notice.waitFor({ timeout: 6000 }).catch(() => {});
  if (await notice.isVisible()) await notice.click();
  await page.locator('[data-row-key="session:' + sessionId + '"]').click({ timeout: 10000 });
  await writeFile(join(cwd, 'trigger-1'), 'go');
  await page.getByRole('tab', { name: /^(File activity|文件活动)$/u }).click({ timeout: 15000 });
  const created = page.getByRole('listitem').filter({ hasText: /Created|新建/u });
  await created.getByText('panel_demo.c', { exact: true }).waitFor();
  await writeFile(join(cwd, 'trigger-2'), 'go');
  const modified = page.getByRole('listitem').filter({ hasText: /Modified|修改/u });
  await modified.getByText('panel_demo.c', { exact: true }).waitFor({ timeout: 15000 });
  assert.equal(await readFile(join(cwd, 'panel_demo.c'), 'utf8'), 'int panel_demo(void) { return 24; }\n');
  const screenshot = process.env.AGENTCODE_DSH_WEB_SCREENSHOT;
  if (screenshot) await page.screenshot({ path: screenshot });
  console.log('Installed DSH Web panel showed a real file creation and an update without reloading.');
} catch (error) {
  const redact = text => String(text).replace(/([?&]token=)[^\s)"']+/gu, '$1[redacted]').replaceAll(key, '[redacted]');
  console.error(redact(error instanceof Error ? error.stack : error));
  console.error(redact(logs));
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (child?.exitCode === null) {
    const closed = new Promise(done => child.once('close', done));
    child.kill();
    await closed;
  }
  provider.closeAllConnections();
  provider.close();
  await rm(temp, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
}
