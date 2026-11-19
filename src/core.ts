import { randomUUID } from 'node:crypto';
import { diffChars, diffLines } from 'diff';

export type Source = 'filesystem' | 'codex' | 'dsh';
export type Provenance = 'observed' | 'native' | 'inferred' | 'presentation';
export type FileOperation = 'created' | 'modified' | 'deleted' | 'renamed';
export type EventType = FileOperation | 'session' | 'turn' | 'tool' | 'diff' | 'connection' | 'notice';

export interface Activity {
  readonly eventId: string;
  readonly timestamp: number;
  readonly sessionId: string;
  readonly agentId: 'Unknown' | 'Codex' | 'DeepSeek Harness';
  readonly source: Source;
  readonly provenance: Provenance;
  readonly eventType: EventType;
  readonly fileUri?: string;
  readonly oldFileUri?: string;
  readonly label?: string;
  readonly before?: string | null;
  readonly after?: string | null;
  readonly status?: string;
  readonly turnId?: string;
  readonly itemId?: string;
  readonly nativePatch?: string;
}

export type ActivityInput = Omit<Activity, 'eventId' | 'timestamp' | 'sessionId'> & {
  sessionId?: string;
  timestamp?: number;
};

export const isSnapshot = (event: Activity) => event.before !== undefined || event.after !== undefined;

export class Engine {
  sessionId = randomUUID() as string;
  private readonly listeners = new Set<(event: Activity) => void>();
  private readonly recent = new Map<string, number>();

  constructor(private readonly reportError: (error: unknown) => void = () => {}) {}

  subscribe(listener: (event: Activity) => void) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  record(input: ActivityInput): Activity | undefined {
    const sessionId = input.sessionId ?? this.sessionId;
    const timestamp = input.timestamp ?? Date.now();
    // Agent transports may report the same lifecycle callback more than once.
    if (input.itemId && input.eventType !== 'diff') {
      const key = JSON.stringify([input.source, sessionId, input.turnId, input.itemId, input.fileUri, input.status, input.eventType]);
      const previous = this.recent.get(key);
      if (previous !== undefined && timestamp - previous < 5000) return;
      this.recent.set(key, timestamp);
      if (this.recent.size > 2048) this.recent.delete(this.recent.keys().next().value!);
    }
    const event = Object.freeze({ ...input, eventId: randomUUID(), sessionId, timestamp });
    for (const listener of this.listeners) {
      try { listener(event); } catch (error) { this.reportError(error); }
    }
    return event;
  }
}

export type LineKind = 'same' | 'add' | 'remove';
export interface LineBlock {
  kind: LineKind;
  lines: string[];
  oldStart: number;
  newStart: number;
}

const split = (text: string) => text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
const diffs = new WeakMap<Activity, ReturnType<typeof calculateDiff>>();

function calculateDiff(before: string, after: string) {
  const exact = diffLines(before, after, { timeout: 35, stripTrailingCr: true });
  const parts = exact ?? [
    { value: before, removed: true, added: false },
    { value: after, removed: false, added: true },
  ];
  let oldStart = 0;
  let newStart = 0;
  let added = 0;
  let removed = 0;
  const blocks: LineBlock[] = [];
  for (const part of parts) {
    const lines = split(part.value);
    if (!lines.length) continue;
    const kind = part.added ? 'add' : part.removed ? 'remove' : 'same';
    blocks.push({ kind, lines, oldStart, newStart });
    if (kind !== 'add') oldStart += lines.length;
    if (kind !== 'remove') newStart += lines.length;
    if (kind === 'add') added += lines.length;
    if (kind === 'remove') removed += lines.length;
  }
  return { blocks, added, removed, coarse: !exact };
}

export function getDiff(event: Activity) {
  let diff = diffs.get(event);
  if (!diff) {
    diff = calculateDiff(event.before ?? '', event.after ?? '');
    diffs.set(event, diff);
  }
  return diff;
}

export function characters(before: string, after: string) {
  if (before.length + after.length > 2048) return;
  return diffChars(before, after, { timeout: 5 });
}
