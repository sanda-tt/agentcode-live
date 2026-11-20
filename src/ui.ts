import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { getDiff, isSnapshot, type Activity } from './core';

export const config = () => vscode.workspace.getConfiguration('agentcodeLive');
let displayLanguage: 'en' | 'zh-CN' = 'en';

export function configureLanguage() {
  const choice = config().get<string>('language', 'auto');
  const useChinese = choice === 'zh-CN' || choice === 'auto' && /^zh(?:-|$)/iu.test(vscode.env.language);
  displayLanguage = useChinese ? 'zh-CN' : 'en';
}

export const tr = (en: string, cn: string) => displayLanguage === 'zh-CN' ? cn : en;

const words: Record<string, string> = {
  created: '新建', modified: '修改', deleted: '删除', renamed: '重命名',
  session: '会话', turn: '任务轮次', tool: '工具', connection: '连接', diff: '差异', notice: '提示',
  observed: '磁盘观察', inferred: '推断', native: '原生事件', presentation: '展示效果',
  started: '开始', inProgress: '进行中', completed: '完成', connected: '已连接',
  disconnected: '已断开', failed: '失败', interrupted: '已中断', declined: '已拒绝',
  Unknown: '未知', 'DeepSeek Harness': 'DeepSeek Harness',
};

const enWords: Record<string, string> = {
  observed: 'Disk observation', inferred: 'Inferred', native: 'Native event', presentation: 'Presentation',
  inProgress: 'In progress',
};
export const word = (key: string) => (displayLanguage === 'zh-CN' ? words[key] : enWords[key]) ?? key.replace(/^./u, letter => letter.toUpperCase());

const labels: Record<string, [string, string]> = {
  codexSession: ['Managed Codex session', '托管 Codex 会话'],
  codexCommand: ['Command execution', '命令执行'],
  codexTurnDiff: ['Turn diff updated', '轮次差异已更新'],
  watcherOverflow: ['Watcher queue full. Some intermediate states were skipped.', '监听队列已满，部分中间状态已跳过。'],
};

const icons: Record<string, string> = {
  created: 'new-file', modified: 'diff-modified', deleted: 'diff-removed', renamed: 'diff-renamed',
  session: 'comment-discussion', turn: 'pulse', tool: 'terminal', diff: 'diff',
  connection: 'plug', notice: 'warning',
};

type FilterKey = 'file' | 'eventType' | 'agentId' | 'sessionId';

export function pathLabel(uri: string | undefined) {
  return uri ? vscode.workspace.asRelativePath(vscode.Uri.parse(uri), (vscode.workspace.workspaceFolders?.length ?? 0) > 1) : '';
}

function title(event: Activity) {
  if (event.label && labels[event.label]) return tr(...labels[event.label]);
  return event.label ?? (event.fileUri ? pathLabel(event.fileUri) : word(event.eventType));
}

function summary(event: Activity) {
  if (!isSnapshot(event)) return event.status ? word(event.status) : '';
  if (event.before === undefined || event.after === undefined) return tr('Partial snapshot', '快照不完整');
  const { added, removed, coarse } = getDiff(event);
  return `${coarse ? '≈ ' : ''}+${added} −${removed}`;
}

export class ActivityTree implements vscode.TreeDataProvider<Activity>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly filters = new Map<FilterKey, string>();
  paused = false;
  private displayed?: Activity[];
  private timer?: NodeJS.Timeout;

  constructor(private readonly events: () => Activity[]) {}

  getTreeItem(event: Activity) {
    const item = new vscode.TreeItem(title(event));
    item.id = event.eventId;
    item.description = [word(event.eventType), summary(event), word(event.agentId)].filter(Boolean).join(' · ');
    item.tooltip = [
      new Date(event.timestamp).toLocaleString(displayLanguage), title(event), item.description,
      word(event.provenance), event.oldFileUri ? pathLabel(event.oldFileUri) + ' → ' + pathLabel(event.fileUri) : '',
      tr('Session', '会话') + ' ' + event.sessionId,
    ].filter(Boolean).join('\n');
    item.iconPath = new vscode.ThemeIcon(icons[event.eventType]);
    if (isSnapshot(event) || event.nativePatch) {
      item.contextValue = 'agentcodeLive.snapshot';
      item.command = { command: 'agentcodeLive.preview', title: tr('Open diff', '打开差异'), arguments: [event] };
    }
    return item;
  }

  getChildren() {
    return (this.displayed ?? this.events()).filter(event => [...this.filters].every(([key, value]) =>
      key === 'file' ? [event.fileUri, event.oldFileUri].some(uri => pathLabel(uri).toLowerCase().includes(value))
        : event[key] === value,
    )).slice(-120).reverse();
  }

  toggle() {
    this.paused = !this.paused;
    this.displayed = this.paused ? this.events() : undefined;
    this.refresh();
  }

  async filter() {
    const fields = [
      { key: 'file', label: tr('File path', '文件路径') },
      { key: 'eventType', label: tr('Operation', '操作') },
      { key: 'agentId', label: 'Agent' },
      { key: 'sessionId', label: tr('Session', '会话') },
    ] as const;
    const field = await vscode.window.showQuickPick(
      [...fields, { key: 'clear' as const, label: tr('Clear all filters', '清除所有筛选') }],
      { placeHolder: tr('Filter Agent Activity', '筛选 Agent 活动') },
    );
    if (!field) return;
    if (field.key === 'clear') this.filters.clear();
    else if (field.key === 'file') {
      const value = await vscode.window.showInputBox({ prompt: field.label, value: this.filters.get(field.key) });
      if (value === undefined) return;
      if (value.trim()) this.filters.set(field.key, value.trim().toLowerCase());
      else this.filters.delete(field.key);
    } else {
      const key = field.key;
      const values = [...new Set(this.events().map(event => event[key]))].sort();
      const selection = await vscode.window.showQuickPick([
        { label: tr('All', '全部'), value: '' },
        ...values.map(value => ({ label: key === 'sessionId' ? value : word(value), value })),
      ], { placeHolder: field.label });
      if (!selection) return;
      if (selection.value) this.filters.set(key, selection.value);
      else this.filters.delete(key);
    }
    this.refresh();
  }

  refresh(force = false) {
    if (force && this.paused) this.displayed = this.events();
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.changed.fire(); }, 120);
  }

  dispose() { clearTimeout(this.timer); this.changed.dispose(); }
}

export class Decorations implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this.changed.event;
  private readonly byFile = new Map<string, Activity>();
  private readonly badges = new Map<string, string>();
  private readonly pending = new Set<string>();
  private timer?: NodeJS.Timeout;
  private added = this.makeAdded();
  private readonly deleteAnchor = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    before: { margin: '0 0.35em 0 0', color: new vscode.ThemeColor('editorGutter.deletedBackground') },
  });

  provideFileDecoration(uri: vscode.Uri) {
    const type = this.badges.get(uri.toString());
    if (!type) return;
    const badge = type === 'created' ? 'N' : type === 'renamed' ? 'R' : 'M';
    const color = type === 'created' ? 'gitDecoration.addedResourceForeground' :
      type === 'renamed' ? 'gitDecoration.renamedResourceForeground' : 'gitDecoration.modifiedResourceForeground';
    return new vscode.FileDecoration(badge, `AgentCode Live · ${word(type)}`, new vscode.ThemeColor(color));
  }

  receive(event: Activity) {
    if (!event.fileUri || event.source !== 'filesystem' || !isSnapshot(event)) return;
    const uri = event.fileUri;
    this.byFile.delete(uri);
    this.badges.delete(uri);
    if (event.eventType !== 'deleted') {
      this.byFile.set(uri, event);
      this.badges.set(uri, event.eventType);
    }
    if (event.oldFileUri) {
      this.byFile.delete(event.oldFileUri);
      this.badges.delete(event.oldFileUri);
      this.pending.add(event.oldFileUri);
    }
    if (this.byFile.size > 28) this.byFile.delete(this.byFile.keys().next().value!);
    if (this.badges.size > 300) {
      const first = this.badges.keys().next().value!;
      this.badges.delete(first);
      this.pending.add(first);
    }
    this.pending.add(uri);
    this.schedule();
  }

  clear() {
    for (const uri of this.badges.keys()) this.pending.add(uri);
    this.byFile.clear();
    this.badges.clear();
    this.schedule();
  }

  configure() {
    this.added.dispose();
    this.added = this.makeAdded();
    for (const editor of vscode.window.visibleTextEditors) this.apply(editor);
  }

  apply(editor: vscode.TextEditor) {
    const event = this.byFile.get(editor.document.uri.toString());
    if (event && Date.now() - event.timestamp >= 12000) this.byFile.delete(editor.document.uri.toString());
    const current = event && Date.now() - event.timestamp < 12000 && !editor.document.isDirty &&
      editor.document.getText() === event.after ? event : undefined;
    const added: vscode.Range[] = [];
    const deleted: vscode.DecorationOptions[] = [];
    if (current) {
      if (current.before === undefined) {
        editor.setDecorations(this.added, []);
        editor.setDecorations(this.deleteAnchor, []);
        return;
      }
      for (const block of getDiff(current).blocks) {
        if (block.kind === 'add') {
          added.push(new vscode.Range(block.newStart, 0, Math.min(editor.document.lineCount - 1, block.newStart + block.lines.length - 1), 0));
        } else if (block.kind === 'remove') {
          const line = Math.min(block.newStart, editor.document.lineCount - 1);
          deleted.push({
            range: new vscode.Range(line, 0, line, 0),
            renderOptions: { before: { contentText: `−${block.lines.length}` } },
            hoverMessage: tr('Open the recorded diff in Agent Activity to see the removed lines.', '在 Agent 活动中打开快照差异，可查看删除的行。'),
          });
        }
      }
    }
    editor.setDecorations(this.added, added);
    editor.setDecorations(this.deleteAnchor, deleted);
  }

  dispose() {
    clearTimeout(this.timer);
    this.changed.dispose();
    this.added.dispose();
    this.deleteAnchor.dispose();
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.changed.fire([...this.pending].map(uri => vscode.Uri.parse(uri)));
      this.pending.clear();
      for (const editor of vscode.window.visibleTextEditors) this.apply(editor);
    }, 100);
  }

  private makeAdded() {
    const color = config().get<string>('addedColor', '');
    return vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: /^#[a-f\d]{3,8}$/iu.test(color) ? color : new vscode.ThemeColor('diffEditor.insertedLineBackground'),
      borderWidth: '0 0 0 2px', borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('editorGutter.addedBackground'),
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
  }
}

export class VirtualDiff implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly contents = new Map<string, string>();
  provideTextDocumentContent(uri: vscode.Uri) { return this.contents.get(uri.toString()) ?? ''; }
  dispose() { this.contents.clear(); }

  async show(event: Activity) {
    if (event.nativePatch !== undefined) {
      await vscode.window.showTextDocument(this.store(event, 'patch', event.nativePatch, 'agent.diff'), { preview: true });
      return;
    }
    if (!isSnapshot(event) || !event.fileUri) return;
    if (event.before === undefined) {
      await vscode.window.showTextDocument(this.store(event, 'after', event.after ?? ''), { preview: true });
      void vscode.window.showInformationMessage(tr('Only the after snapshot was captured.', '仅捕获到变更后的快照。'));
      return;
    }
    const before = this.store(event, 'before', event.before ?? '');
    const after = this.store(event, 'after', event.after ?? '');
    await vscode.commands.executeCommand('vscode.diff', before, after, title(event) + ' · AgentCode Live', { preview: true });
  }

  private store(event: Activity, revision: string, content: string, name?: string) {
    const path = name ?? vscode.Uri.parse((revision === 'before' ? event.oldFileUri : undefined) ?? event.fileUri!).path;
    const filename = path.split('/').pop() || 'snapshot';
    const uri = vscode.Uri.from({ scheme: 'agentcode-live', path: `/${event.eventId}/${revision}/${filename}` });
    this.contents.set(uri.toString(), content);
    if (this.contents.size > 40) this.contents.delete(this.contents.keys().next().value!);
    return uri;
  }
}

const timelineStrings = () => ({
  timeline: tr('Timeline', '时间线'), cinematic: tr('Cinematic preview', '动态预览'),
  presentation: tr('Animated from recorded snapshots', '基于记录的快照播放动画'),
  play: tr('Play', '播放'), pause: tr('Pause', '暂停'), replayChange: tr('Replay change', '重播此变更'),
  live: tr('Watch live', '实时观看'),
  waiting: tr('Waiting for a workspace file change…', '正在等待工作区文件变化…'),
  recordedChange: tr('File change', '文件变化'),
  previous: tr('Previous event', '上一条'), next: tr('Next event', '下一条'),
  position: tr('Playback position', '回放进度'), speed: tr('Playback speed', '回放速度'),
  files: tr('Filter file paths', '筛选文件路径'), allOperations: tr('All operations', '全部操作'),
  allAgents: tr('All agents', '全部 Agent'), allSessions: tr('All sessions', '全部会话'),
  recent: tr('Recorded events', '活动记录'), diff: tr('Diff', '差异'), state: tr('File at this event', '此时文件'),
  native: tr('Open in editor', '在编辑器中打开'), empty: tr('No matching events yet.', '暂无符合条件的活动。'),
  deleted: tr('This file had been deleted.', '此时文件已删除。'),
  unavailable: tr('No file snapshot for this event.', '此事件没有文件快照。'),
  beforeUnknown: tr('Earlier contents unavailable. Showing the first captured state.', '变更前内容不可用，以下是首次读到的状态。'),
  coarse: tr('The line diff reached its time budget. Both complete versions are shown.', '行级差异计算已达到时间上限，以下展示两个完整版本。'),
  truncated: tr('Preview line limit reached. Open in editor to see the full snapshot.', '已达到预览行数上限，可在编辑器中打开完整快照。'),
});

export class Timeline implements vscode.Disposable {
  private readonly uiStrings = timelineStrings();
  private timeline?: vscode.WebviewPanel;
  private cinema?: vscode.WebviewPanel;
  private cinemaSubscription?: vscode.Disposable;
  private timer?: NodeJS.Timeout;
  private live = false;
  private readonly selectedEvents = new Map<string, Activity>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly events: () => Activity[],
    private readonly showDiff: (event: Activity) => Promise<void>,
    private readonly modeChanged: () => void,
  ) {}

  get active() { return Boolean(this.timeline?.active); }
  get replay() { return this.active && !this.live; }

  open(live = false) {
    const existing = this.timeline;
    if (existing) {
      existing.reveal();
      if (live) void existing.webview.postMessage({ type: 'live' });
      return;
    }
    this.live = live;
    const panel = this.create('agentcodeLive.timeline', this.uiStrings.timeline, vscode.ViewColumn.Active, false, live);
    this.timeline = panel;
    panel.onDidDispose(() => { this.timeline = undefined; this.modeChanged(); });
    panel.onDidChangeViewState(() => this.modeChanged());
    panel.webview.onDidReceiveMessage((message: { type: string; id?: string; request?: number; live?: boolean }) => {
      if (message.type === 'ready') this.update();
      if (message.type === 'mode') { this.live = message.live === true; this.modeChanged(); }
      const event = message.id ? this.selectedEvents.get(message.id) : undefined;
      if (message.type === 'select') void panel.webview.postMessage({
        type: 'detail', id: message.id, request: message.request, detail: event && this.detail(event),
        linesPerSecond: config().get('animationLinesPerSecond', 40),
      });
      if (message.type === 'open' && event) void this.showDiff(event);
    });
    this.modeChanged();
  }

  showCinema(event: Activity, background = false) {
    if (!isSnapshot(event)) return;
    if (!this.cinema) {
      const panel = this.create('agentcodeLive.cinematic', this.uiStrings.cinematic, vscode.ViewColumn.Beside, background);
      this.cinema = panel;
      panel.onDidDispose(() => { this.cinema = undefined; this.cinemaSubscription?.dispose(); });
    } else if (!background) this.cinema.reveal();
    const panel = this.cinema;
    const send = () => panel.webview.postMessage({
      type: 'cinematic', event: this.meta(event), detail: this.detail(event),
      linesPerSecond: config().get('animationLinesPerSecond', 40),
    });
    this.cinemaSubscription?.dispose();
    this.cinemaSubscription = panel.webview.onDidReceiveMessage((message: { type: string; id?: string }) => {
      if (message.type === 'ready') void send();
      if (message.type === 'open' && message.id === event.eventId) void this.showDiff(event);
    });
    void send();
  }

  refresh() {
    if (!this.timeline || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.update(); }, 240);
  }

  dispose() {
    clearTimeout(this.timer);
    this.cinema?.dispose();
    this.timeline?.dispose();
  }

  private update() {
    const events = this.events();
    this.selectedEvents.clear();
    for (const event of events) this.selectedEvents.set(event.eventId, event);
    void this.timeline?.webview.postMessage({ type: 'events', events: events.map(event => this.meta(event)) });
  }

  private create(id: string, label: string, column: vscode.ViewColumn, preserveFocus: boolean, live = false) {
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    const web = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel(id, `AgentCode Live · ${label}`, { viewColumn: column, preserveFocus }, {
      enableScripts: true, localResourceRoots: [media, web], retainContextWhenHidden: true,
    });
    panel.iconPath = vscode.Uri.joinPath(media, 'activity.svg');
    const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(web, 'timeline.js'));
    const css = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'timeline.css'));
    const nonce = randomBytes(24).toString('hex');
    const cinema = id.endsWith('cinematic');
    panel.webview.html = `<!doctype html><html lang="${displayLanguage}"><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';">
      <link rel="stylesheet" href="${css}">
      <title>${label}</title></head><body data-mode="${cinema ? 'cinematic' : 'timeline'}" data-live="${live}">
      <header><h1>${label}</h1><p>${this.uiStrings.presentation}</p></header>
      <section id="filters" aria-label="${this.uiStrings.files}"></section>
      <section id="transport"></section>
      <main><section id="events" aria-label="${this.uiStrings.recent}"></section><section id="detail"></section></main>
      <script nonce="${nonce}">window.labels=${JSON.stringify(this.uiStrings)};</script>
      <script nonce="${nonce}" src="${script}"></script></body></html>`;
    return panel;
  }

  private meta(event: Activity) {
    return {
      id: event.eventId, timestamp: event.timestamp, session: event.sessionId,
      agent: word(event.agentId), operation: word(event.eventType), provenance: word(event.provenance),
      kind: event.eventType, snapshot: isSnapshot(event),
      actor: event.agentId === 'Unknown' ? this.uiStrings.recordedChange : word(event.agentId),
      file: pathLabel(event.fileUri), oldFile: pathLabel(event.oldFileUri), label: title(event),
      status: event.status ? word(event.status) : '',
    };
  }

  private detail(event: Activity) {
    const diff = isSnapshot(event) && event.before !== undefined && event.after !== undefined ? getDiff(event) : undefined;
    let lines = 0;
    const blocks = [];
    for (const block of diff?.blocks ?? []) {
      blocks.push({ ...block, lines: block.lines.slice(0, 5000 - lines) });
      lines += block.lines.length;
      if (lines >= 5000) break;
    }
    return {
      snapshot: isSnapshot(event), after: event.after, beforeKnown: event.before !== undefined,
      blocks, coarse: diff?.coarse, patch: event.nativePatch,
      added: diff?.added, removed: diff?.removed,
      truncated: lines >= 5000,
    };
  }
}
