/* global acquireVsCodeApi */
const vscode = acquireVsCodeApi();
const text = window.labels;
const cinema = document.body.dataset.mode === 'cinematic';
const filters = document.querySelector('#filters');
const transport = document.querySelector('#transport');
const list = document.querySelector('#events');
const detail = document.querySelector('#detail');
const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
let events = [];
let visible = [];
let index = -1;
let timer;
let playing = false;
let currentDetail;
let state = false;
let animation = 0;
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

const stepBack = button('‹', () => { pause(); choose(index - 1); }, text.previous);
const stepNext = button('›', () => { pause(); choose(index + 1); }, text.next);
const play = button(text.play, toggle);
const slider = element('input');
slider.type = 'range';
slider.min = '0';
slider.setAttribute('aria-label', text.position);
const position = element('output', '0 / 0', 'position');

if (cinema) {
  transport.append(button(text.play, () => { if (cinemaPayload) playCinema(cinemaPayload); }));
} else {
  filters.append(file, operation, agent, session);
  transport.append(stepBack, play, stepNext, slider, position, speed);
}
for (const input of [file, operation, agent, session]) input.oninput = () => filter(true);
slider.oninput = () => { pause(); choose(Number(slider.value)); };
speed.onchange = () => { if (playing) schedule(); };

function options(input, title, field) {
  const previous = input.value;
  input.replaceChildren(new Option(title, ''));
  for (const value of [...new Set(events.map(event => event[field]))].sort()) {
    input.add(new Option(field === 'session' ? value.slice(0, 12) : value, value));
  }
  input.value = Array.from(input.options).some(item => item.value === previous) ? previous : '';
}

function filter(manual) {
  if (manual) pause();
  const selected = visible[index]?.id;
  const path = file.value.trim().toLowerCase();
  visible = events.filter(event =>
    (!path || [event.file, event.oldFile].some(name => name.toLowerCase().includes(path))) &&
    (!operation.value || event.operation === operation.value) &&
    (!agent.value || event.agent === agent.value) &&
    (!session.value || event.session === session.value));
  const preserved = visible.findIndex(event => event.id === selected);
  choose(preserved >= 0 ? preserved : visible.length - 1, preserved >= 0);
}

function choose(value, keepDetail = false) {
  index = visible.length ? Math.min(visible.length - 1, Math.max(0, value)) : -1;
  const event = visible[index];
  slider.max = String(Math.max(0, visible.length - 1));
  slider.value = String(Math.max(0, index));
  slider.disabled = !event;
  play.disabled = visible.length < 2;
  stepBack.disabled = index <= 0;
  stepNext.disabled = index >= visible.length - 1;
  position.textContent = (index + 1) + ' / ' + visible.length;
  renderEvents();
  if (keepDetail && currentDetail) return;
  currentDetail = undefined;
  if (event) {
    renderDetail(event);
    vscode.postMessage({ type: 'select', id: event.id });
  } else detail.replaceChildren(element('p', text.empty, 'empty'));
}

function renderEvents() {
  const scroll = list.scrollTop;
  list.replaceChildren(element('h2', text.recent, 'section-title'));
  const start = Math.max(0, Math.min(index - 50, visible.length - 100));
  const end = Math.min(start + 100, visible.length);
  let selected;
  for (let cursor = start; cursor < end; cursor++) {
    const event = visible[cursor];
    const row = button('', () => { pause(); choose(cursor); });
    row.className = 'event' + (index === cursor ? ' selected' : '');
    row.title = event.file || event.label;
    if (index === cursor) {
      row.setAttribute('aria-current', 'true');
      selected = row;
    }
    row.append(element('span', event.label, 'event-name'),
      element('span', [time.format(event.timestamp), event.agent, event.operation].join(' · '), 'event-meta'));
    list.append(row);
  }
  list.scrollTop = scroll;
  if (selected && (selected.offsetTop < list.scrollTop || selected.offsetTop + selected.offsetHeight > list.scrollTop + list.clientHeight)) {
    list.scrollTop = Math.max(0, selected.offsetTop - list.clientHeight / 2);
  }
}

function pause() {
  clearTimeout(timer);
  playing = false;
  play.textContent = text.play;
}

function toggle() {
  if (playing) { pause(); return; }
  if (visible.length < 2) return;
  if (index >= visible.length - 1) choose(0);
  playing = true;
  play.textContent = text.pause;
  schedule();
}

function schedule() {
  clearTimeout(timer);
  if (index >= visible.length - 1) { pause(); return; }
  const gap = visible[index + 1].timestamp - visible[index].timestamp;
  timer = setTimeout(() => { choose(index + 1); schedule(); }, Math.min(3000, Math.max(180, gap)) / Number(speed.value));
}

function renderDetail(event, data) {
  const head = element('div', undefined, 'detail-head');
  const heading = element('div');
  heading.append(element('h2', event.label), element('p', [
    time.format(event.timestamp), event.agent, event.provenance, event.status, data?.summary,
  ].filter(Boolean).join(' · ')));
  if (event.oldFile) heading.append(element('p', event.oldFile + ' → ' + event.file));
  head.append(heading);
  if (data?.snapshot || data?.patch) {
    head.append(button(text.native, () => vscode.postMessage({ type: 'open', id: event.id })));
  }
  detail.replaceChildren(head);
  if (!data) return;
  if (data.patch) {
    detail.append(element('pre', data.patch, 'source'));
    return;
  }
  if (!data.snapshot) { detail.append(element('p', text.unavailable, 'empty')); return; }
  if (!cinema) {
    const tabs = element('div', undefined, 'tabs');
    for (const [flag, label] of [[false, text.diff], [true, text.state]]) {
      const tab = button(label, () => { state = flag; renderDetail(event, data); showLines(data); });
      tab.setAttribute('aria-pressed', String(state === flag));
      tabs.append(tab);
    }
    detail.append(tabs);
  }
  if (data.coarse && !state) detail.append(element('p', text.coarse, 'empty'));
  if (data.truncated && !state) detail.append(element('p', text.truncated, 'empty'));
  if (state || !data.beforeKnown) {
    if (!data.beforeKnown) detail.append(element('p', text.beforeUnknown, 'empty'));
    detail.append(data.after == null ? element('p', text.deleted, 'empty') : element('pre', data.after, 'source'));
    return;
  }
  detail.append(element('div', undefined, 'lines'));
}

function line(block, offset) {
  const kind = block.kind;
  const row = element('div', undefined, 'line ' + kind);
  row.append(
    element('span', kind === 'add' ? '' : String(block.oldStart + offset + 1)),
    element('span', kind === 'remove' ? '' : String(block.newStart + offset + 1)),
    element('span', kind === 'add' ? '+' : kind === 'remove' ? '−' : ' '),
    element('code', block.lines[offset].replace(/\r?\n$/u, '')),
  );
  return row;
}

function showLines(data) {
  const lines = detail.querySelector('.lines');
  if (!lines) return;
  const fragment = document.createDocumentFragment();
  for (const block of data.blocks) for (let i = 0; i < block.lines.length; i++) fragment.append(line(block, i));
  lines.append(fragment);
}

function playCinema(payload) {
  const { event, detail: data, linesPerSecond } = payload;
  const generation = ++animation;
  renderDetail(event, data);
  const board = detail.querySelector('.lines');
  if (!board) return;
  let blockIndex = 0;
  let offset = 0;
  let start;
  let shown = 0;
  function advance(now) {
    if (generation !== animation) return;
    start ??= now;
    const budget = 1 + Math.floor((now - start) / 1000 * linesPerSecond);
    const fragment = document.createDocumentFragment();
    while (blockIndex < data.blocks.length && fragment.childElementCount < 240) {
      const block = data.blocks[blockIndex];
      if (block.kind !== 'same' && shown >= budget) break;
      fragment.append(line(block, offset++));
      if (block.kind !== 'same') shown++;
      if (offset === block.lines.length) { offset = 0; blockIndex++; }
    }
    board.append(fragment);
    if (blockIndex < data.blocks.length) requestAnimationFrame(advance);
  }
  requestAnimationFrame(advance);
}

window.addEventListener('message', ({ data }) => {
  if (data.type === 'events') {
    events = data.events;
    options(operation, text.allOperations, 'operation');
    options(agent, text.allAgents, 'agent');
    options(session, text.allSessions, 'session');
    filter(false);
  }
  if (data.type === 'detail' && visible[index]?.id === data.id) {
    currentDetail = data.detail;
    renderDetail(visible[index], currentDetail);
    showLines(currentDetail);
  }
  if (data.type === 'cinematic') {
    cinemaPayload = data;
    playCinema(data);
  }
});
if (!cinema) choose(-1);
vscode.postMessage({ type: 'ready' });
