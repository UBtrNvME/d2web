// d2editor (spec 0013): the D2 text is the only document; canvas actions become d2web edits (spec 0012) and land in it as checked patches.
import { createClient, getObject, mount, spawnWorker, type CompileResult, type EditOp, type EditResult } from '../../d2web/src/index.ts';
import { createHistory } from './history.ts';
import { snap } from './snap.ts';
import { canvas } from './canvas.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const src = $<HTMLTextAreaElement>('src');
const ENTRY = 'main.d2';
// D2's own default light and dark themes follow the system scheme, as in the demo.
const dark = matchMedia('(prefers-color-scheme: dark)');
const render = () => ({ themeId: dark.matches ? 200 : 0, sketch: false, pad: 24, scale: 1, center: false });
// D2's shapes (d2target), for the inspector.
const SHAPES = ['rectangle', 'square', 'page', 'parallelogram', 'document', 'cylinder', 'queue', 'package', 'step', 'callout', 'stored_data', 'person', 'diamond', 'oval', 'circle', 'hexagon', 'cloud', 'text', 'code', 'class', 'sql_table', 'image', 'sequence_diagram', 'c4-person', 'hierarchy'];
const START = 'users: Users {shape: person}\napi: API\ndb: Database {shape: cylinder}\nusers -> api: requests\napi -> db: reads\n';
const EXAMPLES: Record<string, string> = {
  Services: START,
  Container: 'services: {\n  api: API\n  db: Database {shape: cylinder}\n  api -> db\n}\n',
  Boards: 'a: Root\nlayers: {\n  detail: {\n    a: API\n    b: Database\n    a -> b\n  }\n}\n',
};
const STORAGE = 'd2editor.text';
let initial = START;
try { initial = localStorage.getItem(STORAGE) ?? START; } catch { /* storage is optional */ }

const client = createClient({ spawn: spawnWorker() });
const view = mount($('host'));
const history = createHistory(initial);
const camera = canvas($('canvas'), $('host'), v => { $('zoom').textContent = `${Math.round(v.k * 100)}%`; });
// Fit the next painted board: on load, an opened file or example, and a board switch.
let fitNext = true;
// `painted` is the revision the canvas shows.
const state = { text: initial, revision: 0, painted: -1, board: '', result: undefined as CompileResult | undefined, selected: '', connectFrom: '' };
type Range = { start: number; end: number; text: string };
let typing: ReturnType<typeof setTimeout>, idle: ReturnType<typeof setTimeout>, compileRun = 0;
let pending: { revision: number; ids: EditResult['ids']; changed: string[] } | undefined;

function status(message: string, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
  $('status').dataset.state = error ? 'error' : message === 'Compiling…' ? 'busy' : 'ok';
}

// The last patch's ranges, marked in a copy of the text behind the transparent textarea.
function mark(edits: Range[] = []) {
  const marks = $('marks');
  marks.replaceChildren();
  let at = 0, shift = 0;
  for (const e of edits) {
    // Ranges are against the text before the patch; in the new text each starts after the earlier replacements.
    const start = e.start + shift, end = start + e.text.length;
    marks.append(state.text.slice(at, start), Object.assign(document.createElement('mark'), { textContent: state.text.slice(start, end) || ' ' }));
    at = end;
    shift += e.text.length - (e.end - e.start);
  }
  marks.append(state.text.slice(at) + '\n');
  marks.scrollTop = src.scrollTop;
}
src.addEventListener('scroll', () => { $('marks').scrollTop = src.scrollTop; });

async function compile(seeds?: number[]) {
  const revision = state.revision, board = state.board, run = ++compileRun;
  let result: CompileResult;
  try {
    result = await client.compile({ revision, files: { [ENTRY]: state.text }, entry: ENTRY, render: render(), boards: [board], seeds });
  } catch (error) {
    if (run === compileRun && revision === state.revision && (error as Error).name !== 'SupersededError') status(String(error), true);
    return;
  }
  if (revision !== state.revision || run !== compileRun) return;
  if (result.error) {
    // A board the text no longer has falls back to the root.
    if (board && !result.available.includes(board)) { state.board = ''; return compile(seeds); }
    status(result.error.diagnostics.map(d => `${d.range ? `offset ${d.range.start}: ` : ''}${d.message}`).join('\n') || result.error.message, true);
    return;
  }
  $<HTMLSelectElement>('board').replaceChildren(...result.available.map(path => new Option(path || 'root', path, false, path === state.board)));
  const before = state.result?.boards?.find(b => b.path === board)?.association;
  const focused = $('host').shadowRoot?.activeElement?.getAttribute('data-id');
  outline?.remove();
  try { await view.update(result, board); } catch (error) { status(String(error), true); return; }
  if (revision !== state.revision || run !== compileRun) return;
  // The canvas takes the board's own background, so the diagram sits on it rather than on a pasted sheet.
  const paper = $('host').shadowRoot!.querySelector('[data-id="root:background"] [data-k="rect"]');
  $('canvas').style.backgroundColor = paper ? getComputedStyle(paper).backgroundColor : '';
  if (fitNext) { fitNext = false; camera.fit(); }
  const after = result.boards!.find(b => b.path === board)!.association;
  const change = pending?.revision === revision ? pending : undefined;
  if (before) snap($('host').shadowRoot!, before, after, change?.ids, change?.changed);
  pending = undefined;
  state.result = result;
  state.painted = revision;
  if (focused && focused === state.selected) $('host').shadowRoot?.querySelector<HTMLElement>(`[data-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  status(`compiled in ${Math.round(result.millis)} ms`);
  inspect();
}

// Every change of text: typing, a patch, undo, an opened file. Each is a new revision, so older edits and compiles become stale.
function setText(text: string, { record = true, edits, delay = 0 }: { record?: boolean; edits?: Range[]; delay?: number } = {}) {
  clearTimeout(typing);
  clearTimeout(idle);
  state.text = text;
  state.revision++;
  if (record) history.push(text);
  if (src.value !== text) src.value = text;
  mark(edits);
  try { localStorage.setItem(STORAGE, text); } catch { /* storage is optional */ }
  status('Compiling…');
  typing = setTimeout(() => void compile([1]), delay);
  idle = setTimeout(() => void compile(), 1000);
}

src.addEventListener('input', () => setText(src.value, { delay: 250 }));

// One canvas action, one transaction. Only a checked patch changes the text; anything else leaves it as it was.
async function edit(ops: EditOp[]): Promise<EditResult | undefined> {
  const revision = state.revision, board = state.board, selected = state.selected;
  let result: EditResult;
  try { result = await client.edit({ revision, files: { [ENTRY]: state.text }, entry: ENTRY, board, ops }); }
  catch (error) { if (revision === state.revision && board === state.board) status(`${ops[0].op}: ${String(error)}`, true); return; }
  // Raw typing and board switches invalidate an edit even before a debounced compile reaches the client.
  if (revision !== state.revision || board !== state.board) return;
  if (result.patch) {
    follow(result.ids);
    pending = { revision: revision + 1, ids: result.ids, changed: [selected] };
    setText(result.patch.text, { edits: result.patch.edits });
    for (const d of result.diagnostics) status(d.message);
    return result;
  }
  const error = result.error!;
  if (error.code === 'stale') return;
  if (error.code === 'unchecked') return offer(error), undefined;
  status(`${error.op !== undefined ? `${ops[error.op].op} ${ops[error.op].key}: ` : ''}${error.message}`, true);
}

function offer(error: NonNullable<EditResult['error']>) {
  const dialog = $<HTMLDialogElement>('unchecked');
  $('reason').textContent = {
    conflict: 'Your formatting and the edit overlap, and no patch to your text means the same as the edit.',
    inequivalent: 'No patch to your text means the same as the edit.',
    label: 'The edit would change labels it did not set:',
  }[error.reason ?? 'inequivalent'];
  $('labels').replaceChildren(...(error.labels ?? []).map(l => Object.assign(document.createElement('li'), { textContent: l })));
  $('formatted').textContent = error.formatted ?? '';
  const revision = state.revision, board = state.board;
  dialog.onclose = () => { if (dialog.returnValue === 'use' && revision === state.revision && board === state.board) setText(error.formatted!); };
  dialog.returnValue = '';
  dialog.showModal();
}

// Keep the selection on the same object across renames and deletes.
function follow(ids: EditResult['ids']) {
  if (ids.renamed[state.selected]) state.selected = ids.renamed[state.selected];
  if (ids.deleted.includes(state.selected)) state.selected = '';
}

function select(id: string) {
  if (state.connectFrom && id && id !== state.connectFrom) {
    const from = state.connectFrom;
    connecting(false);
    void edit([{ op: 'create', key: `${from} -> ${id}` }]).then(r => { if (r) select(r.ids.created[0] ?? id); });
    return;
  }
  state.selected = id;
  inspect();
}
view.on('click', e => select(e.id));
view.on('focus', e => { if (camera.pressed) return; state.selected = e.id; camera.reveal(e.domEvent.target as Element); inspect(); });

function objectOf(id: string) {
  const board = state.result?.boards?.find(b => b.path === state.board);
  return board && id ? getObject(board.association, id) : undefined;
}

// The selection, outlined at D2's box in the same scene coordinate parent as the object's outer node (as snap.ts does).
let outline: HTMLElement | undefined;
function highlight(object: ReturnType<typeof objectOf>) {
  outline?.remove();
  const box = object?.box, node = object && $('host').shadowRoot?.querySelector(`[data-id="${CSS.escape(object.nodes[0])}"]`);
  if (!box || !node?.parentElement) return;
  outline = Object.assign(document.createElement('div'), { className: 'selection' });
  outline.setAttribute('aria-hidden', 'true');
  outline.style.cssText = `position:absolute;pointer-events:none;left:${box.X}px;top:${box.Y}px;width:${box.Width}px;height:${box.Height}px;outline:2px solid #3975d5;outline-offset:4px;border-radius:2px`;
  node.parentElement.append(outline);
}

function inspect() {
  const object = objectOf(state.selected);
  highlight(object);
  $('inspector').hidden = !object;
  if (!object) return;
  const form = $<HTMLFormElement>('props');
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  $('selected').replaceChildren(Object.assign(document.createElement('span'), { className: 'kind', textContent: object.kind === 'connection' ? 'Connection' : 'Shape' }), ` ${object.id}`);
  for (const name of ['label', 'fill', 'stroke']) {
    if (document.activeElement !== field(name)) field(name).value = object.properties[name]?.value ?? (name === 'label' ? object.label : '');
  }
  // The pickers follow the text field when it holds a hex colour; D2 theme codes and names leave the picker dimmed.
  for (const picker of form.querySelectorAll<HTMLInputElement>('input[type=color]')) {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(field(picker.dataset.for!).value) ? field(picker.dataset.for!).value : '';
    picker.value = hex.length === 4 ? `#${[...hex.slice(1)].map(c => c + c).join('')}` : hex || '#000000';
    picker.classList.toggle('unset', !hex);
  }
  if (document.activeElement !== shapeSelect) shapeSelect.value = object.properties.shape?.value ?? '';
  for (const el of form.querySelectorAll<HTMLElement>('[data-shape-only]')) el.hidden = object.kind === 'connection';
  // Where each value comes from (spec 0004): a declaration in the text, or D2's default.
  $('sources').replaceChildren(...['label', 'fill', 'stroke', 'shape'].flatMap(name => {
    const source = object.properties[name]?.source;
    const dd = Object.assign(document.createElement('dd'), { textContent: source ? `${source.path} line ${source.start.line + 1}` : "D2's default" });
    dd.classList.toggle('default', !source);
    return [Object.assign(document.createElement('dt'), { textContent: name }), dd];
  }));
  const name = $('rename').querySelector('input') as HTMLInputElement;
  if (document.activeElement !== name) name.value = object.id.split('.').pop()!;
}

const shapeSelect = ($<HTMLFormElement>('props').elements.namedItem('shape') as HTMLSelectElement);
shapeSelect.append(new Option("D2's", ''), ...SHAPES.map(s => new Option(s, s)));
$<HTMLFormElement>('props').addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  // A picked colour goes through its text field, so both make the same edit.
  if (input.dataset.for) {
    const text = ($<HTMLFormElement>('props').elements.namedItem(input.dataset.for) as HTMLInputElement);
    text.value = input.value;
    text.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const id = state.selected, value = input.name === 'label' ? input.value : input.value.trim() || null;
  const key = { label: id, fill: `${id}.style.fill`, stroke: `${id}.style.stroke`, shape: `${id}.shape` }[input.name];
  if (key) void edit([{ op: 'set', key, value }]);
});
$<HTMLFormElement>('props').addEventListener('submit', event => event.preventDefault());
$('props').addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); event.target.blur(); }
});

$<HTMLFormElement>('rename').addEventListener('submit', event => {
  event.preventDefault();
  const name = ($('rename').querySelector('input') as HTMLInputElement).value.trim();
  if (name && state.selected) void edit([{ op: 'rename', key: state.selected, name }]);
});
$('delete').addEventListener('click', () => { if (state.selected) void edit([{ op: 'delete', key: state.selected }]); });

// A new shape goes inside the selected shape when it is a container, otherwise at the top level; then its name is ready to type.
$('add').addEventListener('click', async () => {
  const board = state.result?.boards?.find(b => b.path === state.board);
  const parent = objectOf(state.selected)?.kind === 'shape' && board?.association.objects.some(o => o.parent === state.selected) ? state.selected : '';
  const result = await edit([{ op: 'create', key: parent ? `${parent}.shape` : 'shape' }]);
  if (!result) return;
  state.selected = result.ids.created[0];
  await compiled();
  const input = $('rename').querySelector('input') as HTMLInputElement;
  input.focus();
  input.select();
});

function connecting(on: boolean) {
  state.connectFrom = on ? state.selected : '';
  $('connect').setAttribute('aria-pressed', String(on));
  if (on) status(`Connecting from ${state.connectFrom}: click the target, Escape to cancel`);
}
$('connect').addEventListener('click', () => connecting(!state.connectFrom && Boolean(state.selected)));

// Resolves once the canvas shows the current revision (or a newer text replaced it, or it failed to compile).
async function compiled() {
  const revision = state.revision;
  while (state.painted < revision && state.revision === revision && !$('status').classList.contains('error')) await new Promise(r => setTimeout(r, 20));
}

function step(text: string | undefined) {
  if (text === undefined) return;
  state.selected = objectOf(state.selected) ? state.selected : '';
  setText(text, { record: false });
}
$('undo').addEventListener('click', () => step(history.undo()));
$('redo').addEventListener('click', () => step(history.redo()));
$('zoom-in').addEventListener('click', () => camera.zoomBy(1.25));
$('zoom-out').addEventListener('click', () => camera.zoomBy(0.8));
$('zoom').addEventListener('click', () => camera.reset());
$('fit').addEventListener('click', () => camera.fit());
const typingIn = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { connecting(false); select(''); return; }
  // Figma-style view keys outside text fields: +/- zoom, Shift+1 fit, Shift+0 100%.
  if (!typingIn(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const action = { '+': () => camera.zoomBy(1.25), '=': () => camera.zoomBy(1.25), '-': () => camera.zoomBy(0.8), '!': () => camera.fit(), ')': () => camera.reset() }[event.key];
    if (action) { event.preventDefault(); action(); return; }
  }
  if (event.key === 'Enter' && event.target === $('host') && state.connectFrom) { event.preventDefault(); select(state.selected); return; }
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || $<HTMLDialogElement>('unchecked').open) return;
  event.preventDefault();
  step(event.shiftKey ? history.redo() : history.undo());
});

$<HTMLSelectElement>('board').addEventListener('change', event => { state.board = (event.target as HTMLSelectElement).value; state.selected = ''; fitNext = true; connecting(false); pending = undefined; status('Compiling…'); void compile([1]); });

function openText(text: string) {
  history.reset(text);
  state.board = '';
  fitNext = true;
  state.selected = '';
  connecting(false);
  setText(text, { record: false });
}
$<HTMLSelectElement>('example').append(...Object.keys(EXAMPLES).map(name => new Option(name, name)));
$('example').addEventListener('change', event => openText(EXAMPLES[(event.target as HTMLSelectElement).value]));
$<HTMLInputElement>('open').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0], revision = state.revision;
  if (!file) return;
  try { const text = await file.text(); if (revision === state.revision) openText(text); }
  catch (error) { status(`Open: ${String(error)}`, true); }
  input.value = '';
});
$('download').addEventListener('click', () => {
  // Textarea values normalise CRLF; retain the document's line endings until the user types or accepts an edit.
  const url = URL.createObjectURL(new Blob([state.text], { type: 'text/plain;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'diagram.d2' });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

dark.addEventListener('change', () => { status('Compiling…'); void compile(); });
src.value = initial;
setText(initial, { record: false });
