import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { characters, Engine, getDiff } from '../src/core';
import { History } from '../src/history';
import { DshBridge } from '../src/dsh';

test('line and character diffs preserve before and after coordinates', () => {
  const event = new Engine().record({
    source: 'filesystem', agentId: 'Unknown', provenance: 'observed', eventType: 'modified',
    before: 'a\r\nold\r\nc\r\n', after: 'a\nnew\nmore\nc\n',
  })!;
  const diff = getDiff(event);
  assert.deepEqual([diff.added, diff.removed, diff.coarse], [2, 1, false]);
  assert.deepEqual(diff.blocks.map(({ kind, oldStart, newStart }) => [kind, oldStart, newStart]),
    [['same', 0, 0], ['remove', 1, 1], ['add', 2, 1], ['same', 2, 3]]);
  assert.equal(characters('abc', 'adc')!.find(item => item.added)?.value, 'd');
});

test('native events deduplicate and listener failure does not interrupt the stream', () => {
  const rejected: unknown[] = [];
  const engine = new Engine(error => rejected.push(error));
  let seen = 0;
  engine.subscribe(() => { throw new Error('test listener failure'); });
  engine.subscribe(() => { seen++; });
  const entry = {
    source: 'codex', agentId: 'Codex', provenance: 'native', eventType: 'tool', sessionId: 'a', itemId: '1', status: 'started',
  } as const;
  engine.record(entry);
  engine.record(entry);
  engine.record({ ...entry, status: 'completed' });
  engine.record({ ...entry, sessionId: 'b' });
  assert.equal(seen, 3);
  assert.equal(rejected.length, 3);
});

test('bounded history reloads snapshots and clear cannot race a pending flush', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentcode-history-'));
  const path = join(root, 'history.jsonl');
  const fail = (error: unknown) => assert.fail(String(error));
  const history = new History(path, true, 1050, fail);
  const engine = new Engine();
  engine.subscribe(event => history.add(event));
  try {
    for (let index = 0; index < 10; index++) {
      engine.record({ source: 'filesystem', agentId: 'Unknown', provenance: 'observed', eventType: 'created', after: 'v' + index });
    }
    await history.flush();
    const copy = new History(path, true, 1050, fail);
    await copy.load();
    assert.ok(copy.events.length > 1 && copy.events.length < 10);
    assert.equal(copy.events.at(-1)?.after, 'v9');
    await Promise.all([history.flush(), history.clear()]);
    await assert.rejects(readFile(path), { code: 'ENOENT' });
    copy.configure(false, 1050);
    copy.add(copy.events[0]);
    await copy.flush();
    await assert.rejects(readFile(path), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('DSH localhost bridge authenticates events and disconnects cleanly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentcode-bridge-'));
  const path = join(root, 'bridge.json');
  const engine = new Engine();
  const received: string[] = [];
  engine.subscribe(event => received.push(event.eventType + ':' + event.status));
  const bridge = new DshBridge(path, engine, message => assert.fail(message));
  try {
    await bridge.start();
    const { port, key } = JSON.parse(await readFile(path, 'utf8'));
    const send = (token: string, type: string) => fetch('http://127.0.0.1:' + port + '/event', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token },
      body: JSON.stringify({ runtimeId: '12345678-1234-1234-1234-123456789abc', type }),
    });
    assert.equal((await send('x', 'heartbeat')).status, 403);
    assert.equal((await send(key, 'tools/execute')).status, 204);
    assert.equal((await send(key, 'tools/result')).status, 204);
    assert.equal((await send(key, 'goodbye')).status, 204);
    assert.deepEqual(received, ['connection:connected', 'tool:inProgress', 'tool:completed', 'connection:disconnected']);
  } finally {
    bridge.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
