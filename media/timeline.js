/* global acquireVsCodeApi */
import { languageFor, writeCode } from './syntax.js';

const vscode = acquireVsCodeApi();
const text = window.labels;
const cinema = document.body.dataset.mode === 'cinematic';
const filters = document.querySelector('#filters');
const transport = document.querySelector('#transport');
const list = document.querySelector('#events');
const detail = document.querySelector('#detail');
const time = new Intl.DateTimeFormat(document.documentElement.lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const operationIcon = { created: '+', modified: '±', deleted: '−', renamed: '↱' };
let events = [];
let receivedEvents = false;
let visible = [];
let index = -1;
let timer;
let playing = false;
let live = document.body.dataset.live === 'true';
let liveQueue = [];
let waiting = false;
let readyAt = 0;
let request = 0;
let animateSelection = false;
let state = false;
let endMotion;
let cinemaPayload;

function element(tag, value, css) {
  const item = document.createElement(tag);
  if (value !== undefined) item.textContent = value;
  if (css) item.className = css;
  return item;
}

function button(label, fn, aria) {
  const item = element('button', label);
  item.type = 'button';
  if (aria) { item.title = aria; item.setAttribute('aria-label', aria); }
  item.onclick = fn;
  return item;
}

function select(label) {
  const input = element('select');
  input.setAttribute('aria-label', label);
  return input;
}

function splitPath(path) {
  const parts = path.split(/[\\/]/u);
  return [parts.pop(), parts.join('/')];
}

const file = element('input');
file.type = 'search';
file.placeholder = text.files;
file.setAttribute('aria-label', text.files);
const operation = select(text.allOperations);
const agent = select(text.allAgents);
const session = select(text.allSessions);
const speed = select(text.speed);
for (const value of [0.5, 1, 2, 4, 8]) speed.add(new Option(value + '×', value));
speed.value = '1';

const liveButton = button(text.live, () => setLive(!live));
liveButton.className = 'live-toggle';
const stepBack = button('‹', () => manualChoose(index - 1), text.previous);
const stepNext = button('›', () => manualChoose(index + 1), text.next);
const play = button(text.play, toggle);
play.className = 'play';
const slider = element('input');
slider.type = 'range';
slider.min = '0';
slider.setAttribute('aria-label', text.position);
const position = element('output', '0 / 0', 'position');
const replayChange = button(text.replayChange, () => showCinema(cinemaPayload));
replayChange.className = 'play';
replayChange.disabled = true;

if (cinema) transport.append(replayChange);
else {
  filters.append(file, operation, agent, session);
  transport.append(liveButton, stepBack, play, stepNext, slider, position, speed);
}
for (const input of [file, operation, agent, session]) input.oninput = () => filter(true);
slider.oninput = () => manualChoose(Number(slider.value));
speed.onchange = () => { if (playing) schedule(); };

function options(input, title, field) {
  const previous = input.value;
  input.replaceChildren(new Option(title, ''));
  for (const value of [...new Set(events.map(event => event[field]))].sort()) {
    input.add(new Option(field === 'session' ? value.slice(0, 12) : value, value));
  }
  input.value = Array.from(input.options).some(item => item.value === previous) ? previous : '';
}

function filter(manual, arrivals = []) {
  if (manual) {
    pause();
    liveQueue = [];
  }
  const selected = visible[index]?.id;
  const path = file.value.trim().toLowerCase();
  visible = events.filter(event =>
    (!path || [event.file, event.oldFile].some(name => name.toLowerCase().includes(path))) &&
    (!operation.value || event.operation === operation.value) &&
    (!agent.value || event.agent === agent.value) &&
    (!session.value || event.session === session.value));
  const preserved = visible.findIndex(event => event.id === selected);
  if (live && !manual) {
    const fresh = new Set(arrivals);
    const changes = visible.filter(event => event.snapshot && fresh.has(event.id));
    if (preserved >= 0) {
      liveQueue = [...liveQueue, ...changes.map(event => event.id)].slice(-4);
      index = preserved;
      updateNavigation();
      schedule();
      return;
    }
    if (changes.length) {
      const [first, ...rest] = changes.slice(-5);
      liveQueue = rest.map(event => event.id);
      choose(visible.indexOf(first), true);
      return;
    }
  }
  if (live) {
    liveQueue = [];
    choose(visible.findLastIndex(event => event.snapshot));
  } else if (preserved >= 0 && !manual) {
    index = preserved;
    updateNavigation();
  } else {
    choose(preserved >= 0 ? preserved : visible.length - 1);
  }
}

function updateNavigation() {
  const event = visible[index];
  document.body.dataset.live = String(live);
  liveButton.setAttribute('aria-pressed', String(live));
  play.setAttribute('aria-pressed', String(playing));
  play.textContent = playing ? text.pause : text.play;
  slider.max = String(Math.max(0, visible.length - 1));
  slider.value = String(Math.max(0, index));
  slider.style.setProperty('--progress', (visible.length > 1 ? 100 * Math.max(0, index) / (visible.length - 1) : 0) + '%');
  slider.disabled = !visible.length;
  slider.setAttribute('aria-valuetext', event ? String(index + 1) + ' / ' + visible.length + ' · ' + event.label : '0');
  play.disabled = visible.length < 2;
  stepBack.disabled = index <= 0;
  stepNext.disabled = index >= visible.length - 1;
  position.textContent = (index + 1) + ' / ' + visible.length;
  renderEvents();
}

function choose(value, animate = false) {
  endMotion?.();
  const old = visible[index]?.id;
  index = value < 0 ? -1 : Math.min(visible.length - 1, value);
  const event = visible[index];
  const serial = ++request;
  animateSelection = animate;
  readyAt = performance.now();
  waiting = Boolean(event);
  updateNavigation();
  if (event) {
    // Keep the previous frame until its replacement is ready during live viewing and playback.
    if (!animate || !old) renderDetail(event);
    vscode.postMessage({ type: 'select', id: event.id, request: serial });
  } else {
    detail.replaceChildren(element('p', live ? text.waiting : text.empty, 'empty'));
    schedule();
  }
}

function operationMark(event) {
  const mark = element('span', operationIcon[event.kind] ?? '•', 'operation-mark');
  mark.dataset.kind = event.kind;
  mark.setAttribute('aria-hidden', 'true');
  return mark;
}

function renderEvents() {
  const scroll = list.scrollTop;
  const focused = list.contains(document.activeElement) ? document.activeElement.dataset.event : undefined;
  const heading = element('div', undefined, 'rail-heading');
  heading.append(element('h2', text.recent), element('span', String(visible.length)));
  const fragment = document.createDocumentFragment();
  fragment.append(heading);
  const start = Math.max(0, Math.min(index - 50, visible.length - 100));
  const end = Math.min(start + 100, visible.length);
  let selected;
  let restoreFocus;
  for (let cursor = start; cursor < end; cursor++) {
    const event = visible[cursor];
    const row = button('', () => manualChoose(cursor));
    row.className = 'event';
    row.dataset.event = event.id;
    row.title = event.file || event.label;
    if (index === cursor) {
      row.setAttribute('aria-current', 'true');
      selected = row;
    }
    if (focused === event.id) restoreFocus = row;
    const [basename] = splitPath(event.file);
    const caption = element('span', undefined, 'event-caption');
    caption.append(element('span', basename || event.label, 'event-name'),
      element('span', [event.operation, event.agent].join(' · '), 'event-meta'));
    row.append(operationMark(event), caption, element('time', time.format(event.timestamp), 'event-time'));
    fragment.append(row);
  }
  list.replaceChildren(fragment);
  restoreFocus?.focus({ preventScroll: true });
  list.scrollTop = scroll;
  if (selected && (selected.offsetTop < scroll || selected.offsetTop + selected.offsetHeight > scroll + list.clientHeight)) {
    list.scrollTop = Math.max(0, selected.offsetTop - list.clientHeight / 2);
  }
}

function pause() {
  clearTimeout(timer);
  endMotion?.();
  playing = false;
  play.setAttribute('aria-pressed', 'false');
  play.textContent = text.play;
}

function setLive(value, sync = true) {
  if (value === live) return;
  pause();
  live = value;
  liveQueue = [];
  vscode.postMessage({ type: 'mode', live });
  if (live && sync) filter(true);
  else updateNavigation();
}

function manualChoose(value) {
  setLive(false);
  pause();
  choose(value);
}

function toggle() {
  if (playing) { pause(); return; }
  if (visible.length < 2) return;
  setLive(false);
  playing = true;
  choose(index < 0 || index >= visible.length - 1 ? 0 : index, true);
}

function schedule() {
  clearTimeout(timer);
  if (waiting) return;
  const remaining = Math.max(0, readyAt - performance.now());
  if (playing) {
    const next = visible[index + 1];
    if (!next) {
      timer = setTimeout(pause, remaining);
      return;
    }
    const gap = next.timestamp - visible[index].timestamp;
    const interval = Math.min(3000, Math.max(180, gap)) / Number(speed.value);
    timer = setTimeout(() => choose(index + 1, true), Math.max(interval, remaining));
  } else if (live && liveQueue.length) {
    timer = setTimeout(() => {
      while (liveQueue.length) {
        const target = liveQueue.shift();
        const next = visible.findIndex(event => event.id === target);
        if (next > index) { choose(next, true); return; }
      }
    }, remaining);
  }
}

function sourceView(value, language) {
  const source = element('pre', undefined, 'source');
  const code = element('code');
  writeCode(code, value, value.length <= 32768 ? language : undefined);
  source.append(code);
  return source;
}

function renderDetail(event, data) {
  detail.scrollTop = 0;
  const head = element('div', undefined, 'detail-head');
  const heading = element('div', undefined, 'file-heading');
  const [basename, directory] = splitPath(event.file);
  if (directory) heading.append(element('p', directory + '/', 'file-path'));
  heading.append(element('h2', basename || event.label));
  const meta = element('div', undefined, 'file-meta');
  const badge = element('span', undefined, 'file-operation');
  badge.append(operationMark(event), element('span', event.operation));
  meta.append(badge, element('span', [
    event.agent, event.provenance, event.status, time.format(event.timestamp),
  ].filter(Boolean).join(' · ')));
  heading.append(meta);
  head.append(heading);
  if (data?.snapshot || data?.patch) {
    head.append(button(text.native, () => vscode.postMessage({ type: 'open', id: event.id })));
  }
  detail.replaceChildren(head);
  if (!data) return;
  if (event.oldFile) {
    const change = element('p', undefined, 'rename-path');
    change.append(element('span', event.oldFile, 'rename-from'), element('span', '→', 'rename-arrow'),
      element('span', event.file, 'rename-to'));
    detail.append(change);
  }

  const language = languageFor(event.file);
  if (data.patch) {
    detail.append(sourceView(data.patch));
    return;
  }
  if (!data.snapshot) { detail.append(element('p', text.unavailable, 'empty')); return; }
  const tools = element('div', undefined, 'diff-tools');
  if (!cinema) {
    const tabs = element('div', undefined, 'tabs');
    for (const [flag, label] of [[false, text.diff], [true, text.state]]) {
      const tab = button(label, () => {
        pause();
        state = flag;
        renderDetail(event, data);
        showLines(data, event);
        detail.querySelector('.tabs [aria-pressed=true]')?.focus({ preventScroll: true });
        schedule();
      });
      tab.setAttribute('aria-pressed', String(state === flag));
      tabs.append(tab);
    }
    tools.append(tabs);
  }
  if (data.added !== undefined) {
    const counts = element('div', undefined, 'counts');
    if (data.coarse) counts.append(element('span', '≈'));
    counts.append(element('span', '+' + data.added, 'added'), element('span', '−' + data.removed, 'removed'));
    tools.append(counts);
  }
  if (tools.childElementCount) detail.append(tools);
  if (data.coarse && !state) detail.append(element('p', text.coarse, 'empty'));
  if (data.truncated && !state) detail.append(element('p', text.truncated, 'empty'));
  if (state || !data.beforeKnown) {
    if (!data.beforeKnown) detail.append(element('p', text.beforeUnknown, 'empty'));
    detail.append(data.after == null ? element('p', text.deleted, 'empty') : sourceView(data.after, language));
    return;
  }
  const viewport = element('div', undefined, 'code-viewport');
  viewport.append(element('div', undefined, 'lines'));
  detail.append(viewport);
}

function line(block, offset, language) {
  const kind = block.kind;
  const row = element('div', undefined, 'line ' + kind);
  const code = element('code');
  const source = block.lines[offset].replace(/\r?\n$/u, '');
  writeCode(code, source, source.length <= 500 ? language : undefined);
  row.append(
    element('span', kind === 'add' ? '' : String(block.oldStart + offset + 1)),
    element('span', kind === 'remove' ? '' : String(block.newStart + offset + 1)),
    element('span', kind === 'add' ? '+' : kind === 'remove' ? '−' : ' '),
    code,
  );
  return { row, code };
}

function showLines(data, event, linesPerSecond) {
  const canAnimate = linesPerSecond && !data?.coarse && !reducedMotion.matches &&
    !document.body.classList.contains('vscode-reduce-motion');
  const rename = detail.querySelector('.rename-path');
  if (canAnimate && rename) rename.classList.add('moving');
  const board = detail.querySelector('.lines');
  if (!board) return canAnimate && rename ? 650 : 0;
  const language = languageFor(event.file);
  const fragment = document.createDocumentFragment();
  const changes = [];
  let contextHighlights = 240;
  let changeHighlights = 240;
  for (const block of data.blocks) {
    const changed = block.kind !== 'same';
    for (let offset = 0; offset < block.lines.length; offset++) {
      const highlight = changed ? changeHighlights-- > 0 : contextHighlights-- > 0;
      const item = line(block, offset, highlight ? language : undefined);
      fragment.append(item.row);
      if (canAnimate && changed && changes.length < 120) changes.push(item);
    }
  }
  board.append(fragment);
  return changes.length ? animateLines(board, changes, event.actor, linesPerSecond) : canAnimate && rename ? 650 : 0;
}

function animateLines(board, changes, label, linesPerSecond) {
  const actor = element('span', undefined, 'edit-cursor');
  actor.setAttribute('aria-hidden', 'true');
  actor.append(element('span', undefined, 'cursor-arrow'), element('span', label, 'cursor-label'));
  board.append(actor);
  for (const { row } of changes) row.classList.add('await-change');

  const duration = Math.min(1850, Math.max(390, changes.length / linesPerSecond * 1000));
  const lead = 160;
  const tail = 380;
  let frame;
  let start;
  let active;
  let width;
  let shown = -1;
  const finish = () => {
    cancelAnimationFrame(frame);
    for (const { row } of changes) row.classList.remove('await-change', 'active-change');
    actor.remove();
    endMotion = undefined;
  };
  function focus(item) {
    const viewport = detail.getBoundingClientRect();
    const target = item.row.getBoundingClientRect();
    if (target.top < viewport.top + 18 || target.bottom > viewport.bottom - 36) {
      detail.scrollTop += target.top - viewport.top - detail.clientHeight * 0.42;
    }
    actor.dataset.kind = item.row.classList.contains('remove') ? 'remove' : 'add';
    actor.classList.toggle('align-above', board.offsetHeight - item.row.offsetTop < 52);
    width = Math.min(item.code.offsetWidth, board.parentElement.clientWidth - item.code.offsetLeft - 38);
  }
  function advance(now) {
    start ??= now;
    const elapsed = now - start;
    const beat = Math.max(0, Math.min(changes.length, (elapsed - lead) / duration * changes.length));
    const next = Math.min(changes.length - 1, Math.floor(beat));
    if (next !== shown) {
      for (let i = Math.max(shown, 0); i < next; i++) changes[i].row.classList.remove('await-change', 'active-change');
      active = changes[next];
      active.row.classList.replace('await-change', 'active-change');
      focus(active);
      shown = next;
    }
    const progress = beat - shown;
    active.code.style.setProperty('--edge', 100 * progress + '%');
    const x = active.code.offsetLeft + Math.max(0, width) * progress;
    const y = active.row.offsetTop + active.row.offsetHeight * 0.55;
    actor.classList.toggle('align-left', x > board.parentElement.scrollLeft + board.parentElement.clientWidth - 110);
    actor.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    actor.classList.add('visible');
    if (beat >= changes.length) active.row.classList.remove('active-change');
    if (elapsed > lead + duration + tail - 145) actor.classList.remove('visible');
    if (elapsed >= lead + duration + tail) finish();
    else frame = requestAnimationFrame(advance);
  }
  endMotion = finish;
  frame = requestAnimationFrame(advance);
  return lead + duration + tail;
}

function showCinema(payload) {
  if (!payload) return;
  endMotion?.();
  cinemaPayload = payload;
  const { event, detail: data, linesPerSecond } = payload;
  renderDetail(event, data);
  showLines(data, event, linesPerSecond);
  replayChange.disabled = false;
}

window.addEventListener('message', ({ data }) => {
  if (data.type === 'events') {
    const previous = new Set(events.map(event => event.id));
    const arrivals = receivedEvents ? data.events.filter(event => !previous.has(event.id)).map(event => event.id) : [];
    receivedEvents = true;
    events = data.events;
    options(operation, text.allOperations, 'operation');
    options(agent, text.allAgents, 'agent');
    options(session, text.allSessions, 'session');
    filter(false, arrivals);
  }
  if (data.type === 'detail' && data.request === request && visible[index]?.id === data.id) {
    const event = visible[index];
    waiting = false;
    renderDetail(event, data.detail);
    const rate = animateSelection && (playing || live) ? data.linesPerSecond * (playing ? Number(speed.value) : 1) : 0;
    readyAt = performance.now() + showLines(data.detail, event, rate);
    schedule();
  }
  if (data.type === 'cinematic' && cinemaPayload?.event.id !== data.event.id) showCinema(data);
  if (data.type === 'live') setLive(true);
});

if (!cinema) choose(-1);
vscode.postMessage({ type: 'ready' });
