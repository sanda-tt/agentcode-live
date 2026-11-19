import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import { formatPatch, parsePatch } from 'diff';
import type { ActivityInput, Engine } from './core';

interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, any>;
  result?: any;
  error?: { code?: number; message?: string };
}

class AppServer {
  private nextId = 0;
  private buffer = '';
  private readonly requests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private readonly child: ChildProcessWithoutNullStreams;
  private closed = false;

  constructor(executable: string, cwd: string, onMessage: (message: RpcMessage) => void, onClose: (error: Error) => void, log: (text: string) => void) {
    this.child = spawn(executable, ['app-server', '--listen', 'stdio://'], { cwd, windowsHide: true });
    this.child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      this.buffer += chunk;
      let end: number;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        if (line.trim()) this.receive(line, onMessage, log);
      }
      if (this.buffer.length > 4 * 1024 * 1024) this.dispose();
    });
    this.child.stderr.resume();
    const closed = (error: Error) => {
      if (this.closed) return;
      this.closed = true;
      for (const request of this.requests.values()) {
        clearTimeout(request.timeout);
        request.reject(error);
      }
      this.requests.clear();
      onClose(error);
    };
    this.child.on('error', closed);
    this.child.stdin.on('error', closed);
    this.child.on('close', code => closed(new Error(`Codex App Server exited (${code ?? 'signal'})`)));
  }

  request(method: string, params: object) {
    return new Promise<any>((resolve, reject) => {
      const id = ++this.nextId;
      if (this.closed) return reject(new Error('Codex App Server disconnected'));
      const timeout = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, 30000);
      this.requests.set(id, { resolve, reject, timeout });
      this.send({ id, method, params });
    });
  }

  notify(method: string) { this.send({ method }); }
  dispose() { this.child.stdin.end(); this.child.kill(); }

  private send(message: RpcMessage) {
    if (!this.closed && this.child.stdin.writable) this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  private receive(line: string, onMessage: (message: RpcMessage) => void, log: (text: string) => void) {
    if (line.length > 4 * 1024 * 1024) return;
    try {
      const message = JSON.parse(line) as RpcMessage;
      if (message.id !== undefined && message.method) {
        if (message.method === 'item/fileChange/requestApproval' || message.method === 'item/commandExecution/requestApproval') {
          this.send({ id: message.id, result: { decision: 'decline' } });
        } else {
          this.send({ id: message.id, error: { code: -32601, message: 'Unsupported client request' } });
        }
      } else if (typeof message.id === 'number') {
        const request = this.requests.get(message.id);
        if (!request) return;
        this.requests.delete(message.id);
        clearTimeout(request.timeout);
        if (message.error) request.reject(new Error(message.error.message ?? 'Codex RPC error'));
        else request.resolve(message.result);
      } else if (message.method) {
        onMessage(message);
      }
    } catch { log('Ignored an invalid Codex App Server message'); }
  }
}

export class ManagedCodex {
  private server?: AppServer;
  private root?: string;
  private threadId?: string;
  private running = false;
  private turnPatches = new Map<string, string>();

  constructor(
    private readonly engine: Engine,
    private readonly allowedUri: (path: string) => Promise<string | undefined>,
    private readonly log: (text: string) => void,
  ) {}

  async prompt(executable: string, cwd: string, text: string) {
    if (this.running) throw new Error('A managed Codex turn is already running.');
    if (this.root !== cwd) this.dispose();
    this.running = true;
    let server = this.server;
    try {
      if (!server || !this.threadId) {
        this.root = cwd;
        let notifications = Promise.resolve();
        const created = new AppServer(executable, cwd, message => {
          notifications = notifications.then(() => {
            if (this.server === created) return this.handle(message, cwd);
          }).catch(() => this.log('Could not read a Codex notification'));
        }, error => {
          if (this.server !== created) return;
          this.dispose();
          this.log(error.message);
        }, this.log);
        this.server = server = created;
        await server.request('initialize', { clientInfo: { name: 'agentcode_live', title: 'AgentCode Live', version: '0.1.0' } });
        server.notify('initialized');
        const result = await server.request('thread/start', { cwd, approvalPolicy: 'never', sandbox: 'workspace-write', ephemeral: true });
        if (this.server !== server) throw new Error('Managed Codex disconnected during startup.');
        this.threadId = result.thread.id;
        this.record({ eventType: 'session', status: 'connected', label: 'codexSession' });
      }
      await server.request('turn/start', { threadId: this.threadId, input: [{ type: 'text', text, text_elements: [] }] });
    } catch (error) {
      if (this.server === server) this.dispose();
      throw error;
    }
  }

  dispose() {
    const server = this.server;
    this.server = undefined;
    server?.dispose();
    if (server) this.record({ eventType: 'connection', status: 'disconnected' });
    this.threadId = undefined;
    this.running = false;
  }

  private record(input: Pick<ActivityInput, 'eventType'> & Partial<ActivityInput>) {
    this.engine.record({
      source: 'codex', provenance: 'native', agentId: 'Codex', sessionId: this.threadId, ...input,
    });
  }

  private async handle({ method, params }: RpcMessage, cwd: string) {
    if (!params || params.threadId !== this.threadId) return;
    if (method === 'turn/started' || method === 'turn/completed') {
      if (method === 'turn/started') this.turnPatches.clear();
      if (method === 'turn/completed') this.running = false;
      this.record({ eventType: 'turn', turnId: params.turn?.id, status: params.turn?.status });
    } else if (method === 'turn/diff/updated' && typeof params.diff === 'string') {
      await this.recordTurnDiff(cwd, params.turnId, params.diff);
    } else if (method === 'item/fileChange/patchUpdated' && Array.isArray(params.changes)) {
      await this.recordFileChanges(cwd, params.changes, params.turnId, params.itemId, 'updated');
    } else if (method === 'item/started' || method === 'item/completed') {
      const { item, turnId } = params;
      if (!item) return;
      const common = { turnId, itemId: item.id, status: item.status };
      if (item.type === 'commandExecution') this.record({ ...common, eventType: 'tool', label: 'codexCommand' });
      if (item.type !== 'fileChange' || !Array.isArray(item.changes)) return;
      await this.recordFileChanges(cwd, item.changes, common.turnId, common.itemId, common.status);
    }
  }

  private async recordFileChanges(cwd: string, changes: { path?: string; kind?: { move_path?: string; type?: string }; diff?: string }[],
    turnId: string | undefined, itemId: string | undefined, status: string | undefined) {
    const server = this.server;
    for (const change of changes) {
      if (typeof change.path !== 'string') continue;
      const fileUri = await this.allowedUri(resolve(cwd, change.path));
      if (server !== this.server) return;
      if (!fileUri) continue;
      const destination = change.kind?.move_path;
      const newUri = typeof destination === 'string' ? await this.allowedUri(resolve(cwd, destination)) : undefined;
      if (server !== this.server) return;
      if (destination && !newUri) continue;
      const eventType = newUri ? 'renamed' : change.kind?.type === 'add' ? 'created' : change.kind?.type === 'delete' ? 'deleted' : 'modified';
      const nativePatch = typeof change.diff === 'string' && change.diff.length <= 256 * 1024 ? change.diff : undefined;
      this.record({ turnId, itemId, status, eventType, fileUri: newUri ?? fileUri, oldFileUri: newUri ? fileUri : undefined, nativePatch });
    }
  }

  private async recordTurnDiff(cwd: string, turnId: string | undefined, diff: string) {
    const server = this.server;
    let patches: ReturnType<typeof parsePatch>;
    try { patches = diff.length <= 512 * 1024 ? parsePatch(diff) : []; }
    catch { patches = []; }
    if (!patches.length) {
      this.record({ eventType: 'diff', turnId, label: 'codexTurnDiff' });
      return;
    }
    for (const patch of patches) {
      const oldPath = patch.oldFileName && patch.oldFileName !== '/dev/null' ? patch.oldFileName.replace(/^a\//u, '') : undefined;
      const newPath = patch.newFileName && patch.newFileName !== '/dev/null' ? patch.newFileName.replace(/^b\//u, '') : undefined;
      const paths = [...new Set([oldPath, newPath].filter((path): path is string => Boolean(path)))];
      if (!paths.length) continue;
      const uris = await Promise.all(paths.map(path => this.allowedUri(resolve(cwd, path))));
      if (server !== this.server) return;
      if (uris.some(uri => !uri)) continue;
      const fileUri = uris.at(-1)!;
      const nativePatch = formatPatch(patch);
      if (this.turnPatches.get(fileUri) === nativePatch) continue;
      this.turnPatches.set(fileUri, nativePatch);
      if (this.turnPatches.size > 80) this.turnPatches.delete(this.turnPatches.keys().next().value!);
      this.record({ eventType: 'diff', turnId, fileUri, oldFileUri: uris.length > 1 ? uris[0] : undefined, nativePatch });
    }
  }
}
