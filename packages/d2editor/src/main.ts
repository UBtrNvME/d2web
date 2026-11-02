// d2editor (spec 0013): the D2 text is the only document; canvas actions become d2web edits (spec 0012) and land in it as checked patches.
import { createClient, getObject, mount, spawnWorker, type CompileResult, type EditOp, type EditResult } from '../../d2web/src/index.ts';
import { createHistory } from './history.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const src = $<HTMLTextAreaElement>('src');
const ENTRY = 'main.d2';
const render = { themeId: 0, sketch: false, pad: 24, scale: 1, center: false };
// D2's shapes (d2target), for the inspector.
const SHAPES = ['rectangle', 'square', 'page', 'parallelogram', 'document', 'cylinder', 'queue', 'package', 'step', 'callout', 'stored_data', 'person', 'diamond', 'oval', 'circle', 'hexagon', 'cloud', 'text', 'code', 'class', 'sql_table', 'image', 'sequence_diagram', 'c4-person'];
const START = 'users: Users {shape: person}\napi: API\ndb: Database {shape: cylinder}\nusers -> api: requests\napi -> db: reads\n';

const client = createClient({ spawn: spawnWorker({ worker: new URL('./worker.js', location.href), exec: new URL('./wasm_exec.js', location.href), wasm: new URL('./d2web.wasm', location.href) }) });
const view = mount($('host'));
const history = createHistory(START);
// `painted` is the revision the canvas shows.
const state = { text: START, revision: 0, painted: -1, board: '', result: undefined as CompileResult | undefined, selected: '', connectFrom: '' };
type Range = { start: number; end: number; text: string };

function status(message: string, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

// The last patch's ranges, marked in a copy of the text behind the transparent textarea.
function mark(edits: Range[] = []) {
  const marks = $('marks');
  marks.replaceChildren();
  let at = 0, shift = 0;
  for (const e of edits) {
    // Ranges are against the text before the patch; in the new text each starts after the earlier replacements.
    const start = e.start + shift, end = start + e.text.length;
    marks.append(src.value.slice(at, start), Object.assign(document.createElement('mark'), { textContent: src.value.slice(start, end) || ' ' }));
    at = end;
    shift += e.text.length - (e.end - e.start);
  }
  marks.append(src.value.slice(at) + '\n');
  marks.scrollTop = src.scrollTop;
}
src.addEventListener('scroll', () => { $('marks').scrollTop = src.scrollTop; });

async function compile() {
  const revision = state.revision;
  let result: CompileResult;
  try {
    result = await client.compile({ revision, files: { [ENTRY]: state.text }, entry: ENTRY, render, boards: [state.board] });
  } catch (error) {
    if ((error as Error).name !== 'SupersededError') status(String(error), true);
    return;
  }
  if (revision !== state.revision) return;
  if (result.error) {
    // A board the text no longer has falls back to the root.
    if (state.board && !result.available.includes(state.board)) { state.board = ''; return compile(); }
    status(result.error.diagnostics.map(d => `${d.range ? `offset ${d.range.start}: ` : ''}${d.message}`).join('\n') || result.error.message, true);
    return;
  }
  $<HTMLSelectElement>('board').replaceChildren(...result.available.map(path => new Option(path || 'root', path, false, path === state.board)));
  await view.update(result, state.board);
  state.result = result;
  state.painted = revision;
  status(`compiled in ${Math.round(result.millis)} ms`);
  inspect();
}

// Every change of text: typing, a patch, undo, an opened file. Each is a new revision, so older edits and compiles become stale.
function setText(text: string, { record = true, edits }: { record?: boolean; edits?: Range[] } = {}) {
  state.text = text;
  state.revision++;
  if (record) history.push(text);
  if (src.value !== text) src.value = text;
  mark(edits);
  void compile();
}

let typing: ReturnType<typeof setTimeout>;
src.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => setText(src.value), 250); });

// One canvas action, one transaction. Only a checked patch changes the text; anything else leaves it as it was.
async function edit(ops: EditOp[]): Promise<EditResult | undefined> {
  clearTimeout(typing);
  if (src.value !== state.text) setText(src.value); // pending typing first, so the edit applies to what is on screen
  const result = await client.edit({ revision: state.revision, files: { [ENTRY]: state.text }, entry: ENTRY, board: state.board, ops });
  if (result.patch) {
    follow(result.ids);
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
  const revision = state.revision;
  dialog.onclose = () => { if (dialog.returnValue === 'use' && revision === state.revision) setText(error.formatted!); };
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
view.on('focus', e => select(e.id));

function objectOf(id: string) {
  const board = state.result?.boards?.find(b => b.path === state.board);
  return board && id ? getObject(board.association, id) : undefined;
}

function inspect() {
  const object = objectOf(state.selected);
  $('inspector').hidden = !object;
  if (!object) return;
  const form = $<HTMLFormElement>('props');
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  $('selected').textContent = `${object.kind === 'connection' ? 'Connection' : 'Shape'} ${object.id}`;
  field('label').value = object.properties.label?.value ?? object.label;
  field('fill').value = object.properties.fill?.value ?? '';
  field('stroke').value = object.properties.stroke?.value ?? '';
  for (const el of form.querySelectorAll<HTMLElement>('[data-shape-only]')) el.hidden = object.kind === 'connection';
  // Where each value comes from (spec 0004): a declaration in the text, or D2's default.
  $('sources').textContent = ['label', 'fill', 'stroke'].map(name => {
    const source = object.properties[name]?.source;
    return `${name}: ${source ? `${source.path} line ${source.start.line + 1}` : "D2's default"}`;
  }).join('\n');
  ($('rename').querySelector('input') as HTMLInputElement).value = object.id.split('.').pop()!;
}

const shapeSelect = ($<HTMLFormElement>('props').elements.namedItem('shape') as HTMLSelectElement);
shapeSelect.append(new Option("D2's", ''), ...SHAPES.map(s => new Option(s, s)));
$<HTMLFormElement>('props').addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  const id = state.selected, value = input.value.trim() || null;
  const key = { label: id, fill: `${id}.style.fill`, stroke: `${id}.style.stroke`, shape: `${id}.shape` }[input.name];
  if (key) void edit([{ op: 'set', key, value }]);
});
$<HTMLFormElement>('props').addEventListener('submit', event => event.preventDefault());

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
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { connecting(false); select(''); return; }
  if (event.target === src || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
  event.preventDefault();
  step(event.shiftKey ? history.redo() : history.undo());
});

$<HTMLSelectElement>('board').addEventListener('change', event => { state.board = (event.target as HTMLSelectElement).value; state.selected = ''; void compile(); });

src.value = START;
setText(START, { record: false });
