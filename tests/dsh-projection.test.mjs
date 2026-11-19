import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileActivityProjection as projection } from '../packages/dsh-plugin/changes.js';

const cwd = resolve('example');
const start = (state, name = 'write') => projection.apply(state, {
  type: 'tool/call', data: { callId: 'call-1', name },
});
const result = (state, meta, isError = false) => projection.apply(state, {
  type: 'tool/result', data: { message: { toolCallId: 'call-1', isError }, meta }, seq: 20, time: 2000,
});

test('DSH file activity shares bounded path and status metadata only', () => {
  const empty = projection.init({ cwd });
  const pending = start(empty);
  assert.equal(projection.wire.view(pending), projection.wire.view(empty));
  const created = result(pending, { operation: 'create', path: resolve(cwd, 'main.c'), diffs: [] });
  assert.deepEqual(projection.wire.view(created), [{ id: '20:main.c', path: 'main.c', operation: 'created', time: 2000 }]);

  const patched = result(start(created, 'apply_patch'), { diffs: [
    { path: 'src/main.c', oldText: 'private before', newText: 'private after' },
    { path: 'src/main.c' },
    { path: '..\\outside.c' },
    { path: 'config/.env.production' },
    { path: resolve(cwd, '..', 'outside.c') },
  ] });
  assert.deepEqual(patched.rows.map(row => row.path), ['src/main.c', 'main.c']);
  assert.equal(patched.rows[0].operation, 'patched');
  assert.equal(JSON.stringify(projection.wire.view(patched)).includes('private'), false);
});

test('DSH file activity only credits correlated and successful native tools', () => {
  const empty = projection.init({ cwd });
  const meta = { diffs: [{ path: 'notes.c' }] };
  assert.equal(result(empty, meta), empty);
  assert.equal(result(start(empty, 'shell'), meta), empty);
  assert.equal(result(start(empty), meta, true).rows, empty.rows);
});
