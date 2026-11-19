import { lstat, open, readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import ignore from 'ignore';
import type { Engine, FileOperation } from './core';

const hardIgnore = ignore().add([
  '.git', 'node_modules', 'dist', 'build', 'out', 'target', '.cache', '.venv', 'venv',
  '__pycache__', '.pytest_cache', 'coverage', 'vendor', '.next', '.turbo', '.vscode-test',
  '.env', '.env.*', '*.pem', '*.key', '*.pfx', '*.p12', '*.kdbx', '*.keystore',
  '.npmrc', '.netrc', '.ssh', '.aws', '.codex', '.dsh', 'id_rsa*', 'id_ed25519*',
  'credentials.json', 'secrets.json', '.DS_Store', 'Thumbs.db', '*.swp', '*.tmp', '*~',
]);

export const watcherGlob = '**/*';
type Signal = 'create' | 'change' | 'delete';
type Snapshot = string | null | undefined;
interface Pending { first: Signal; timestamp: number }
interface Change { path: string; before: Snapshot; after: Snapshot; type: FileOperation; timestamp: number }

export interface Root { path: string; uri: (path: string) => string }

export class Observer {
  private readonly pending = new Map<string, Pending>();
  private readonly renames = new Map<string, string>();
  private readonly snapshots = new Map<string, string>();
  private readonly rules = new Map<string, ReturnType<typeof ignore>>();
  private readonly realDirectories = new Map<string, Promise<boolean>>();
  private readonly userIgnore: ReturnType<typeof ignore>;
  private snapshotBytes = 0;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private ready = false;
  private busy = false;
  private overflow = false;

  constructor(
    private readonly root: Root,
    private readonly engine: Engine,
    private readonly maxFileBytes: number,
    ignoreRules: string[],
    private readonly reportError: (error: unknown) => void,
  ) {
    this.userIgnore = ignore().add(ignoreRules);
  }

  async start() {
    try {
      const directories = [this.root.path];
      let files = 0;
      while (directories.length && files < 12000 && this.snapshotBytes < 48 * 1024 * 1024 && !this.stopped) {
        const directory = directories.pop()!;
        try {
          const entries = await readdir(directory, { withFileTypes: true });
          await this.loadRules(directory);
          const paths: string[] = [];
          for (const entry of entries) {
            const path = join(directory, entry.name);
            if (!this.accepts(path, entry.isDirectory())) continue;
            if (entry.isDirectory()) directories.push(path);
            if (entry.isFile()) paths.push(path);
          }
          for (let start = 0; start < paths.length && files < 12000 && !this.stopped; start += 12) {
            const batch = paths.slice(start, start + 12);
            files += batch.length;
            await Promise.all(batch.map(async path => {
              if (this.pending.has(path)) return;
              try {
                const snapshot = await this.read(path);
                if (typeof snapshot === 'string' && !this.pending.has(path) && !this.stopped) this.remember(path, snapshot);
              } catch (error) { this.reportError(error); }
            }));
          }
        } catch (error) { this.reportError(error); }
      }
    } finally {
      this.ready = true;
      this.schedule();
    }
  }

  signal(path: string, signal: Signal) {
    if (this.stopped) return;
    if (basename(path) === '.gitignore') this.rules.delete(dirname(path));
    if (signal !== 'change') {
      this.realDirectories.delete(path);
      for (const directory of this.realDirectories.keys()) {
        if (directory.startsWith(path + sep)) this.realDirectories.delete(directory);
      }
      if (signal === 'delete') {
        this.rules.delete(path);
        // Some watcher backends emit only the deleted directory.
        for (const known of this.snapshots.keys()) {
          if (known.startsWith(path + sep)) this.queue(known, 'delete');
        }
      }
    }
    if (this.accepts(path, false, false)) this.queue(path, signal);
    this.schedule();
  }

  rename(from: string, to: string) {
    this.signal(from, 'delete');
    this.signal(to, 'create');
    if (this.pending.has(from) && this.pending.has(to)) this.renames.set(from, to);
  }

  async allows(path: string) {
    if (!this.accepts(path, false, false)) return false;
    await this.ensureRules(dirname(path));
    return !this.stopped && this.accepts(path) && await this.safeDirectory(dirname(path));
  }

  dispose() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.pending.clear();
    this.renames.clear();
    this.snapshots.clear();
    this.rules.clear();
    this.realDirectories.clear();
  }

  private queue(path: string, signal: Signal) {
    if (this.pending.has(path)) return;
    if (this.pending.size >= 10000) {
      this.overflow = true;
      this.remember(path, undefined);
      return;
    }
    this.pending.set(path, { first: signal, timestamp: Date.now() });
  }

  private schedule() {
    if (!this.ready || this.stopped || this.busy || this.timer || !this.pending.size) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.drain();
    }, 85);
  }

  private async drain() {
    this.busy = true;
    try {
      const batch = [...this.pending].slice(0, 180);
      for (const [path] of batch) this.pending.delete(path);
      const changes: Change[] = [];
      for (let start = 0; start < batch.length && !this.stopped; start += 12) {
        const entries = await Promise.all(batch.slice(start, start + 12).map(async ([path, signal]) => {
          try { return await this.collect(path, signal); }
          catch (error) { this.reportError(error); }
        }));
        for (const entry of entries) if (entry) changes.push(entry);
      }
      if (this.stopped) return;
      const byPath = new Map(changes.map(change => [change.path, change]));
      const regularAdds = new Map<string, Change[]>();
      const regularDeletes = new Map<string, Change[]>();
      for (const change of changes) {
        const [map, content] = change.type === 'created' ? [regularAdds, change.after] : [regularDeletes, change.before];
        if ((change.type === 'created' || change.type === 'deleted') && typeof content === 'string' && content.length > 0) {
          const matches = map.get(content) ?? [];
          matches.push(change);
          map.set(content, matches);
        }
      }
      const paired = new Set<Change>();
      for (const deletion of changes) {
        if (deletion.type !== 'deleted') continue;
        const destination = this.renames.get(deletion.path);
        const reported = destination ? byPath.get(destination) : undefined;
        const content = deletion.before;
        const inferred = typeof content === 'string' && regularDeletes.get(content)?.length === 1 &&
          regularAdds.get(content)?.length === 1 ? regularAdds.get(content)?.[0] : undefined;
        const addition = reported ?? inferred;
        if (!addition || paired.has(addition) || addition.after == null) continue;
        paired.add(deletion);
        paired.add(addition);
        this.emit({ ...addition, type: 'renamed', before: deletion.before }, deletion.path, reported ? 'observed' : 'inferred');
      }
      for (const change of changes) if (!paired.has(change)) this.emit(change);
      for (const [path] of batch) this.renames.delete(path);
      if (this.overflow) {
        this.overflow = false;
        this.engine.record({
          source: 'filesystem', provenance: 'observed', agentId: 'Unknown',
          eventType: 'notice', label: 'watcherOverflow',
        });
      }
    } finally {
      this.busy = false;
      this.schedule();
    }
  }

  private async collect(path: string, signal: Pending): Promise<Change | undefined> {
    const before = this.snapshots.get(path);
    await this.ensureRules(dirname(path));
    if (this.stopped) return;
    if (!this.accepts(path)) {
      this.remember(path, undefined);
      return;
    }
    let after = await this.read(path);
    if (after === null && signal.first !== 'delete' && before !== undefined) {
      // Windows replacements can briefly leave a path missing.
      await new Promise(resolve => setTimeout(resolve, 40));
      after = await this.read(path);
    }
    if (this.stopped) return;
    if (after === undefined) {
      this.remember(path, undefined);
      return;
    }
    if (after === null && before === undefined && signal.first !== 'delete') return;
    this.remember(path, after ?? undefined);
    if (before === after || (after === null && before === undefined && signal.first === 'delete' && !this.renames.has(path))) return;
    const type = after === null ? 'deleted' : before === undefined && signal.first === 'create' ? 'created' : 'modified';
    return { path, before: type === 'created' ? null : before, after, type, timestamp: signal.timestamp };
  }

  private emit(change: Change, oldPath?: string, provenance: 'observed' | 'inferred' = 'observed') {
    this.engine.record({
      agentId: 'Unknown', source: 'filesystem', provenance, eventType: change.type,
      fileUri: this.root.uri(change.path), oldFileUri: oldPath ? this.root.uri(oldPath) : undefined,
      before: change.before, after: change.after, timestamp: change.timestamp,
    });
  }

  private remember(path: string, text: string | undefined) {
    const old = this.snapshots.get(path);
    if (old !== undefined) this.snapshotBytes -= old.length * 2 + path.length * 2 + 96;
    this.snapshots.delete(path);
    if (text === undefined) return;
    this.snapshots.set(path, text);
    this.snapshotBytes += text.length * 2 + path.length * 2 + 96;
    while (this.snapshotBytes > 48 * 1024 * 1024 || this.snapshots.size > 12000) {
      const first = this.snapshots.keys().next().value!;
      const oldText = this.snapshots.get(first)!;
      this.snapshots.delete(first);
      this.snapshotBytes -= oldText.length * 2 + first.length * 2 + 96;
    }
  }

  private accepts(path: string, directory = false, gitRules = true) {
    const rel = relative(this.root.path, path).split(sep).join('/');
    if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return false;
    const candidate = rel + (directory ? '/' : '');
    if (hardIgnore.ignores(candidate) || this.userIgnore.ignores(candidate)) return false;
    if (!gitRules) return true;
    const parts = rel.split('/');
    let current = this.root.path;
    let ignored = false;
    for (let index = 0; index < parts.length; index++) {
      const matcher = this.rules.get(current);
      if (matcher) {
        const match = matcher.test(parts.slice(index).join('/') + (directory ? '/' : ''));
        if (match.ignored || match.unignored) ignored = match.ignored;
      }
      current = join(current, parts[index]);
    }
    return !ignored;
  }

  private async ensureRules(directory: string) {
    if (directory !== this.root.path) {
      const rel = relative(this.root.path, directory);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) return;
      await this.ensureRules(dirname(directory));
    }
    if (!this.rules.has(directory) && await this.safeDirectory(directory)) await this.loadRules(directory);
  }

  private async loadRules(directory: string) {
    const content = await this.read(join(directory, '.gitignore'));
    this.rules.set(directory, ignore().add(content ?? ''));
  }

  private safeDirectory(path: string): Promise<boolean> {
    if (path === this.root.path) return Promise.resolve(true);
    let result = this.realDirectories.get(path);
    if (!result) {
      result = this.safeDirectory(dirname(path)).then(async valid => {
        if (!valid) return false;
        try { return (await lstat(path)).isDirectory(); }
        catch (error) {
          if (missing(error)) return false;
          throw error;
        }
      });
      this.realDirectories.set(path, result);
      if (this.realDirectories.size > 12000) this.realDirectories.delete(this.realDirectories.keys().next().value!);
    }
    return result;
  }

  private async read(path: string): Promise<Snapshot> {
    try {
      if (!await this.safeDirectory(dirname(path))) return null;
      const info = await lstat(path);
      if (!info.isFile() || info.size > this.maxFileBytes) return undefined;
      const fd = await open(path, 'r');
      try {
        const buffer = Buffer.allocUnsafe(Math.min(this.maxFileBytes + 1, info.size + 65537));
        let count = 0;
        while (count < buffer.length) {
          const { bytesRead } = await fd.read(buffer, count, buffer.length - count, count);
          if (bytesRead === 0) break;
          count += bytesRead;
        }
        // A growing file that filled the buffer will have another watcher signal.
        if (count === buffer.length || count > this.maxFileBytes) return undefined;
        const bytes = buffer.subarray(0, count);
        if (bytes.includes(0)) return undefined;
        try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
        catch { return undefined; }
      } finally { await fd.close(); }
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }
}

function missing(error: unknown) {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '');
}
