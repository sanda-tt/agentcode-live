import { isAbsolute, relative, win32 } from 'node:path';
import { z } from 'zod';

const maxRows = 40;
const row = z.object({
  id: z.string(), path: z.string(), operation: z.enum(['created', 'modified', 'patched']), time: z.number(),
});
const rows = z.array(row).max(maxRows);
const trackedTools = new Set(['write', 'edit', 'apply_patch', 'str_replace_editor']);
const call = z.object({ id: z.string(), tool: z.string() });

// This adapter consumes the file result metadata emitted by DSH 0.2.2-rc.5.
// Only path and status reach the authenticated Session projection.
export const fileActivityProjection = {
  key: 'agentcodeLiveFiles',
  stateVersion: 1,
  stateSchema: z.object({ cwd: z.string().nullable(), rows, calls: z.array(call).max(80) }),
  init: header => ({ cwd: header.cwd ?? null, rows: [], calls: [] }),
  apply(state, event) {
    if (event.type === 'tool/call' && trackedTools.has(event.data.name)) {
      return { ...state, calls: [...state.calls, { id: event.data.callId, tool: event.data.name }].slice(-80) };
    }
    if (event.type !== 'tool/result') return state;
    const match = state.calls.findLast(call => call.id === event.data.message.toolCallId);
    if (!match) return state;
    const next = { ...state, calls: state.calls.filter(call => call !== match) };
    const meta = event.data.meta;
    if (event.data.message.isError || !meta || !Array.isArray(meta.diffs)) return next;
    const operation = meta.operation === 'create' ? 'created' : match.tool === 'apply_patch' ? 'patched' : 'modified';
    const paths = operation === 'created' ? [meta.path] : meta.diffs.slice(0, 240).map(hunk => hunk?.path);
    const changes = [];
    const seen = new Set();
    for (const value of paths) {
      const path = localPath(state.cwd, value);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      changes.push({ id: event.seq + ':' + path, path, operation, time: event.time });
      if (changes.length >= maxRows) break;
    }
    return changes.length ? { ...next, rows: [...changes, ...state.rows].slice(0, maxRows) } : next;
  },
  wire: { viewSchema: rows, view: state => state.rows, summary: false },
};

function localPath(cwd, value) {
  if (typeof value !== 'string' || !value || value.length > 500 || /[\u0000-\u001f\u007f]/u.test(value)) return;
  const absolute = isAbsolute(value) || win32.isAbsolute(value);
  if (absolute && (!cwd || !isAbsolute(value))) return;
  const path = (absolute ? relative(cwd, value) : value).replaceAll('\\', '/');
  if (!path || isAbsolute(path) || win32.isAbsolute(path) || path.startsWith('~') || path.includes(':')) return;
  const parts = path.split('/').filter(part => part && part !== '.');
  const sensitive = /^(?:\.\.|\.git|\.ssh|\.aws|\.codex|\.dsh|\.env(?:\..*)?|credentials(?:\..*)?|secrets(?:\..*)?|\.npmrc|\.netrc)$|\.(?:key|pem|pfx|p12)$/iu;
  if (!parts.length || parts.some(part => sensitive.test(part))) return;
  return parts.join('/');
}
