import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { Engine, getDiff, isSnapshot, type Activity } from './core';
import { Observer, watcherGlob } from './observer';
import { History } from './history';
import { ManagedCodex } from './codex';
import { DshBridge } from './dsh';
import { ActivityTree, config, Decorations, Timeline, tr, VirtualDiff } from './ui';

let history: History | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const workspace = context.storageUri?.fsPath;
  if (!workspace) return;
  const own = <T extends vscode.Disposable>(item: T) => { context.subscriptions.push(item); return item; };
  const output = own(vscode.window.createOutputChannel('AgentCode Live'));
  const report = (error: unknown) => output.appendLine(error instanceof Error ? error.message : String(error));
  const engine = new Engine(report);
  const enabled = () => config().get('enabled', true);
  const historyEnabled = () => config().get('history', true);
  const historyLimit = () => config().get('maxHistoryMiB', 24) * 1024 * 1024;
  const follow = () => context.workspaceState.get('followOverride', config().get('follow', false));
  const local = () => (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === 'file');
  const store = history = new History(join(workspace, 'history.jsonl'), historyEnabled(), historyLimit(), report);
  await store.load();

  const tree = own(new ActivityTree(() => store.events));
  const view = own(vscode.window.createTreeView('agentcodeLive.activity', { treeDataProvider: tree }));
  const decorations = own(new Decorations());
  own(vscode.window.registerFileDecorationProvider(decorations));
  const virtualDiff = own(new VirtualDiff());
  own(vscode.workspace.registerTextDocumentContentProvider('agentcode-live', virtualDiff));
  const status = own(vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 35));
  let observers: { root: vscode.WorkspaceFolder; observer: Observer; watcher: vscode.FileSystemWatcher }[] = [];
  let startup = Promise.resolve();
  const connected = new Set<string>();
  const activeTurns = new Map<string, string>();
  let lastChange = 0;
  let lastWorkspaceTyping = 0;
  let latest: Activity | undefined;
  let bridge: DshBridge | undefined;
  const descriptor = join(workspace, 'dsh-bridge.json');
  const codex = own(new ManagedCodex(engine, async path => {
    for (const { observer } of observers) if (await observer.allows(path)) return vscode.Uri.file(path).toString();
  }, report));
  const timeline = own(new Timeline(context.extensionUri, () => store.events, event => virtualDiff.show(event), updateStatus));
  let followTimer: NodeJS.Timeout | undefined;
  let statusTimer: NodeJS.Timeout | undefined;
  let highlightTimer: NodeJS.Timeout | undefined;
  let queuedFollow: Activity | undefined;
  let followSequence = Promise.resolve();

  function updateStatus() {
    const paused = tree.paused || !enabled();
    const isActive = activeTurns.size > 0 || Date.now() - lastChange < 3000;
    const disconnected = context.workspaceState.get('dshEnabled', false) &&
      ![...connected].some(key => key.startsWith('dsh:'));
    const state = paused ? ['debug-pause', 'Paused', '已暂停'] :
      timeline?.replay ? ['history', 'Replay', '回放'] :
        isActive ? ['pulse', activeTurns.size > 0 ? 'Agent Active' : 'File activity', activeTurns.size > 0 ? 'Agent 活跃' : '文件活动'] :
          disconnected ? ['debug-disconnect', 'Disconnected', '已断开'] : ['eye', 'Watching', '监听中'];
    status.text = `$(${state[0]}) AgentCode Live · ${tr(state[1], state[2])}`;
    status.tooltip = tr('Open AgentCode Live Timeline', '打开 AgentCode Live 时间线');
    status.command = 'agentcodeLive.timeline';
    status.show();
    const text = [
      tr(state[1], state[2]), follow() ? tr('Follow on', '跟随开启') : tr('Follow off', '跟随关闭'),
      latest?.fileUri ? vscode.workspace.asRelativePath(vscode.Uri.parse(latest.fileUri)) : '',
    ].filter(Boolean).join(' · ');
    if (view.description !== text) view.description = text;
  }

  async function jump(event: Activity, background = false) {
    if (!event.fileUri || event.eventType === 'deleted') {
      if (!background) await virtualDiff.show(event);
      return;
    }
    const uri = vscode.Uri.parse(event.fileUri);
    if (background && (vscode.window.activeTextEditor?.document.isDirty || Date.now() - lastWorkspaceTyping < 1600)) return;
    const document = await vscode.workspace.openTextDocument(uri);
    let editor = vscode.window.visibleTextEditors.find(item => item.document === document);
    if (background && (tree.paused || !follow() || vscode.window.activeTextEditor?.document.isDirty || Date.now() - lastWorkspaceTyping < 1600)) return;
    if (!background || !editor) {
      const hasEditor = vscode.window.visibleTextEditors.length > 0;
      editor = await vscode.window.showTextDocument(document, {
        preview: true, preserveFocus: background,
        viewColumn: background && hasEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
      });
    }
    if (editor.document.isDirty || !isSnapshot(event)) return;
    const block = event.before !== undefined && getDiff(event).blocks.find(part => part.kind !== 'same');
    if (block && editor.document.getText() === event.after) {
      const line = Math.min(block.newStart, document.lineCount - 1);
      editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    decorations.apply(editor);
  }

  function scheduleFollow(event: Activity) {
    queuedFollow = event;
    if (followTimer) return;
    followTimer = setTimeout(() => {
      followTimer = undefined;
      followSequence = followSequence.then(async () => {
        const current = queuedFollow;
        queuedFollow = undefined;
        if (!current || !enabled() || tree.paused || !follow() || timeline.replay ||
          vscode.window.activeTextEditor?.document.isDirty || Date.now() - lastWorkspaceTyping < 1600) return;
        if (config().get<string>('mode') === 'cinematic') timeline.showCinema(current, true);
        else await jump(current, true);
      }).catch(report);
    }, 240);
  }

  own(engine.subscribe(event => {
    store.add(event);
    timeline.refresh();
    if (event.eventType === 'connection' || event.eventType === 'session' && event.source === 'codex') {
      const key = event.source + ':' + event.sessionId;
      if (event.status === 'connected') connected.add(key);
      if (event.status === 'disconnected') {
        connected.delete(key);
        for (const [turn, source] of activeTurns) if (source === event.source) activeTurns.delete(turn);
      }
    }
    if (event.eventType === 'turn') {
      if (event.status === 'inProgress' || event.status === 'started') activeTurns.set(event.sessionId, event.source);
      else activeTurns.delete(event.sessionId);
    }
    if (!tree.paused && isSnapshot(event)) {
      latest = event;
      lastChange = Date.now();
      decorations.receive(event);
      clearTimeout(statusTimer);
      statusTimer = setTimeout(updateStatus, 3100);
      clearTimeout(highlightTimer);
      highlightTimer = setTimeout(() => vscode.window.visibleTextEditors.forEach(editor => decorations.apply(editor)), 12050);
      if (follow()) scheduleFollow(event);
    }
    if (!tree.paused) tree.refresh();
    updateStatus();
  }));

  function stopObservers() {
    for (const { observer, watcher } of observers) { watcher.dispose(); observer.dispose(); }
    observers = [];
  }

  function startObservers() {
    stopObservers();
    if (!enabled()) { startup = Promise.resolve(); return; }
    const starting: Promise<void>[] = [];
    for (const root of local()) {
      const settings = vscode.workspace.getConfiguration('agentcodeLive', root.uri);
      const observer = new Observer(
        { path: root.uri.fsPath, uri: path => vscode.Uri.file(path).toString() }, engine,
        settings.get('maxFileKiB', 256) * 1024, settings.get('ignore', []), report,
      );
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, watcherGlob));
      watcher.onDidCreate(uri => observer.signal(uri.fsPath, 'create'));
      watcher.onDidChange(uri => observer.signal(uri.fsPath, 'change'));
      watcher.onDidDelete(uri => observer.signal(uri.fsPath, 'delete'));
      observers.push({ root, observer, watcher });
      starting.push(observer.start());
    }
    startup = Promise.all(starting).then(() => {});
  }

  async function startBridge() {
    if (bridge) return;
    const next = bridge = new DshBridge(descriptor, engine, report);
    try { await next.start(); }
    catch (error) { next.dispose(); bridge = undefined; throw error; }
  }

  const command = (name: string, run: (...args: any[]) => unknown) =>
    own(vscode.commands.registerCommand('agentcodeLive.' + name, run));

  command('timeline', () => timeline.open());
  command('filter', () => tree.filter());
  command('preview', (event?: Activity) => event && virtualDiff.show(event));
  command('openFile', (event?: Activity) => event && jump(event).catch(report));
  command('cinematic', (event?: Activity) => event && timeline.showCinema(event));
  command('follow', async () => {
    await context.workspaceState.update('followOverride', !follow());
    updateStatus();
  });
  command('pause', () => {
    tree.toggle();
    if (tree.paused) decorations.clear();
    updateStatus();
  });
  command('session', () => {
    engine.sessionId = randomUUID();
    engine.record({ source: 'filesystem', provenance: 'observed', agentId: 'Unknown', eventType: 'session', status: 'started' });
  });
  command('clear', async () => {
    const clear = tr('Clear history', '清除历史');
    if (await vscode.window.showWarningMessage(tr('Delete all recorded snapshots for this workspace?', '删除该工作区的所有历史快照？'), { modal: true }, clear) !== clear) return;
    await store.clear();
    decorations.clear();
    tree.refresh(true);
    timeline.refresh();
  });
  command('dsh', async () => {
    try {
      await startBridge();
      await context.workspaceState.update('dshEnabled', true);
      await vscode.env.clipboard.writeText(descriptor);
      updateStatus();
      void vscode.window.showInformationMessage(tr('DSH descriptor path copied. Set AGENTCODE_LIVE_DSH_DESCRIPTOR before launching DSH.', '已复制 DSH 描述文件路径。请在启动 DSH 前设置 AGENTCODE_LIVE_DSH_DESCRIPTOR。'));
    } catch (error) { void vscode.window.showErrorMessage(String(error)); }
  });
  command('codex', async () => {
    const roots = local();
    const root = roots.length === 1 ? roots[0] : (await vscode.window.showQuickPick(roots.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder }))))?.folder;
    if (!root) return;
    const prompt = await vscode.window.showInputBox({
      prompt: tr('Managed Codex task in ' + root.name, '在 ' + root.name + ' 中运行托管 Codex 任务'),
      ignoreFocusOut: true,
    });
    if (!prompt?.trim()) return;
    try { await codex.prompt(config().get<string>('codexExecutable', 'codex'), root.uri.fsPath, prompt); }
    catch (error) { void vscode.window.showErrorMessage(String(error)); }
  });
  command('codexStop', () => codex.dispose());

  own(vscode.workspace.onDidChangeWorkspaceFolders(() => { startObservers(); updateStatus(); }));
  own(vscode.workspace.onDidRenameFiles(event => {
    for (const { oldUri, newUri } of event.files) {
      for (const { observer } of observers) observer.rename(oldUri.fsPath, newUri.fsPath);
    }
  }));
  own(vscode.workspace.onDidChangeConfiguration(event => {
    if (!event.affectsConfiguration('agentcodeLive')) return;
    store.configure(historyEnabled(), historyLimit());
    if (event.affectsConfiguration('agentcodeLive.follow')) {
      void context.workspaceState.update('followOverride', undefined).then(updateStatus);
    }
    if (event.affectsConfiguration('agentcodeLive.addedColor')) decorations.configure();
    if (['enabled', 'maxFileKiB', 'ignore'].some(key => event.affectsConfiguration('agentcodeLive.' + key))) {
      decorations.clear();
      startObservers();
    }
    updateStatus();
  }));
  own(vscode.window.onDidChangeVisibleTextEditors(editors => editors.forEach(editor => decorations.apply(editor))));
  own(vscode.workspace.onDidChangeTextDocument(event => {
    if (event.document.uri.scheme !== 'file' || !event.contentChanges.length) return;
    if (event.document.isDirty) {
      lastWorkspaceTyping = Date.now();
      for (const editor of vscode.window.visibleTextEditors) if (editor.document === event.document) decorations.apply(editor);
    } else if (latest?.fileUri === event.document.uri.toString()) {
      setTimeout(() => {
        for (const editor of vscode.window.visibleTextEditors) if (editor.document === event.document) decorations.apply(editor);
      }, 100);
    }
  }));
  own({ dispose: () => {
    stopObservers();
    bridge?.dispose();
    clearTimeout(statusTimer);
    clearTimeout(followTimer);
    clearTimeout(highlightTimer);
  } });
  startObservers();
  if (context.workspaceState.get('dshEnabled', false)) await startBridge().catch(report);
  updateStatus();

  // The extension host integration suite uses the same live event stream as the UI.
  return {
    events: () => store.events,
    whenReady: () => startup,
    decoration: (uri: vscode.Uri) => decorations.provideFileDecoration(uri),
    connectDsh: async () => { await startBridge(); return descriptor; },
    runCodex: (cwd: string, prompt: string) => codex.prompt(config().get<string>('codexExecutable', 'codex'), cwd, prompt),
  };
}

export async function deactivate() { await history?.flush(); }
