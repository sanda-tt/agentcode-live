import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Activity } from './core';

export class History {
  private records: { event: Activity; bytes: number }[] = [];
  private bytes = 0;
  private timer?: NodeJS.Timeout;
  private io = Promise.resolve();
  private revision = 0;

  constructor(
    private readonly path: string,
    private enabled: boolean,
    private limit: number,
    private readonly reportError: (error: unknown) => void,
  ) {}

  async load() {
    if (!this.enabled) return;
    try {
      const data = await readFile(this.path);
      for (const line of data.toString('utf8', Math.max(0, data.length - this.limit)).split('\n').slice(data.length > this.limit ? 1 : 0)) {
        if (!line) continue;
        try {
          const event = JSON.parse(line) as Activity;
          if (typeof event.eventId === 'string' && typeof event.sessionId === 'string') this.append(event);
        } catch { /* Ignore an incomplete record. */ }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.reportError(error);
    }
  }

  get events() { return this.records.map(record => record.event); }

  add(event: Activity) {
    this.append(event);
    this.schedule();
  }

  configure(enabled: boolean, limit: number) {
    this.enabled = enabled;
    this.limit = limit;
    this.trim();
    this.schedule();
  }

  clear() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.records = [];
    this.bytes = 0;
    this.revision++;
    return this.enqueue(() => rm(this.path, { force: true }));
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.enabled) return this.io;
    const rev = this.revision;
    return this.enqueue(async () => {
      if (!this.enabled || rev !== this.revision) return;
      await mkdir(dirname(this.path), { recursive: true });
      const temp = this.path + '.tmp';
      await writeFile(temp, this.records.map(({ event }) => JSON.stringify(event) + '\n').join(''), { mode: 0o600 });
      await rename(temp, this.path);
    });
  }

  private append(event: Activity) {
    const bytes = Buffer.byteLength(JSON.stringify(event)) + 1;
    if (bytes > this.limit) return;
    this.bytes += bytes;
    this.records.push({ event, bytes });
    this.trim();
  }

  private trim() {
    while (this.bytes > this.limit || this.records.length > 3000) this.bytes -= this.records.shift()!.bytes;
  }

  private schedule() {
    if (this.enabled && !this.timer) {
      this.timer = setTimeout(() => void this.flush(), 1800);
    }
  }

  private enqueue(write: () => Promise<unknown>) {
    this.io = this.io.then(write).then(() => {}, error => this.reportError(error));
    return this.io;
  }
}
