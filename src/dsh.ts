import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname } from 'node:path';
import type { Engine } from './core';

const updates = {
  'session/created': ['session', 'started'],
  'session/disposed': ['session', 'completed'],
  'turn/start': ['turn', 'inProgress'],
  'turn/end': ['turn', 'completed'],
  'tools/execute': ['tool', 'inProgress'],
  'tools/result': ['tool', 'completed'],
} as const;

export class DshBridge {
  private readonly key = randomBytes(32).toString('hex');
  private readonly clients = new Map<string, number>();
  private readonly server = createServer({ requestTimeout: 3000, headersTimeout: 3000 }, (req, res) => this.receive(req, res));
  private timer?: NodeJS.Timeout;
  private closed = false;

  constructor(
    private readonly descriptor: string,
    private readonly engine: Engine,
    private readonly log: (text: string) => void,
  ) { this.server.maxConnections = 16; }

  async start() {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.removeListener('error', reject);
        this.server.on('error', error => this.log(error.message));
        resolve();
      });
    });
    if (this.closed) return;
    const { port } = this.server.address() as AddressInfo;
    await mkdir(dirname(this.descriptor), { recursive: true });
    const temp = this.descriptor + '.tmp';
    await writeFile(temp, JSON.stringify({ version: 1, port, key: this.key }), { mode: 0o600 });
    await rename(temp, this.descriptor);
    if (this.closed) return;
    this.timer = setInterval(() => {
      for (const [runtimeId, lastSeen] of this.clients) {
        if (Date.now() - lastSeen > 16000) this.disconnect(runtimeId);
      }
    }, 3000);
  }

  dispose() {
    this.closed = true;
    clearInterval(this.timer);
    this.server.close();
    this.server.closeAllConnections();
    this.clients.clear();
  }

  private receive(req: IncomingMessage, res: ServerResponse) {
    const key = req.headers.authorization;
    if (req.method !== 'POST' || req.url !== '/event' || req.headers.origin ||
      typeof key !== 'string' || !/^Bearer [a-f0-9]{64}$/u.test(key) ||
      !timingSafeEqual(Buffer.from(key.slice(7)), Buffer.from(this.key))) {
      res.writeHead(403).end();
      return;
    }
    const parts: Buffer[] = [];
    let length = 0;
    req.on('data', (part: Buffer) => {
      length += part.length;
      if (length > 4096) req.destroy();
      else parts.push(part);
    });
    req.on('error', () => {});
    req.on('end', () => {
      try {
        this.ingest(JSON.parse(Buffer.concat(parts).toString('utf8')));
        res.writeHead(204).end();
      } catch { res.writeHead(400).end(); }
    });
  }

  private ingest(body: Record<string, unknown>) {
    const { runtimeId, type, error } = body;
    if (typeof runtimeId !== 'string' || !/^[a-f0-9-]{36}$/u.test(runtimeId) || typeof type !== 'string') throw new Error('Invalid event');
    if (type === 'goodbye') {
      this.disconnect(runtimeId);
      return;
    }
    if (!this.clients.has(runtimeId)) {
      if (this.clients.size >= 32) throw new Error('Too many clients');
      this.engine.record({ source: 'dsh', provenance: 'native', agentId: 'DeepSeek Harness', eventType: 'connection', status: 'connected', sessionId: runtimeId });
    }
    this.clients.set(runtimeId, Date.now());
    if (type === 'heartbeat') return;
    const update = Object.hasOwn(updates, type) ? updates[type as keyof typeof updates] : undefined;
    if (!update) throw new Error('Invalid type');
    this.engine.record({
      source: 'dsh', provenance: 'native', agentId: 'DeepSeek Harness',
      eventType: update[0], status: error === true ? 'failed' : update[1],
      sessionId: identifier(body.sessionId) ?? runtimeId, itemId: identifier(body.itemId),
      turnId: identifier(body.turnId), label: update[0] === 'tool' ? identifier(body.tool) : undefined,
    });
  }

  private disconnect(runtimeId: string) {
    if (!this.clients.delete(runtimeId)) return;
    this.engine.record({ source: 'dsh', provenance: 'native', agentId: 'DeepSeek Harness', eventType: 'connection', status: 'disconnected', sessionId: runtimeId });
  }
}

function identifier(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return typeof value === 'string' && /^[\w.:/-]{1,160}$/u.test(value) ? value : undefined;
}
