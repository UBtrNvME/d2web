// d2editor (spec 0013): the D2 text is the only document; canvas actions become d2web edits (spec 0012) and land in it as checked patches.
import { createClient, getObject, objectsAt, type Association, type Diagnostic, mount, spawnWorker, type CompileResult, type EditOp, type EditResult, type Engine, type SceneDocument } from '../../d2web/src/index.ts';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import { standardKeymap } from '@codemirror/commands';
import { setDiagnostics } from '@codemirror/lint';
import { sourceLanguage } from './source-language.ts';
import { sourceValues, valueEdit } from './source-values.ts';
import { outlineView } from './outline-view.ts';
import { sourceFolds, bodyRanges, replaceFolds, diagnosticUnfolds } from './source-folds.ts';
import { textChange } from './source-value.ts';
import { createHistory } from './history.ts';
import { outerNodes, snap } from './snap.ts';
import { canvas, type Grab } from './canvas.ts';
import { leaves, moveOps, NUDGE, placeShifting } from './position.ts';
import { connectTarget, dropTarget, freeKey } from './targets.ts';
import { diagramOf, hasHandle, movable, press } from './traits.ts';
import { decodeScript, encodeScript } from './share.ts';
import { capabilities, setOps, type Field } from './capabilities.ts';
import { actionsOf, convert, kindOf, kinds, sectionsOf, type Control } from './kinds/index.ts';
import { renderFields, renderRows } from './inspector.ts';
import keywordTable from './keywords.json' with { type: 'json' };


const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ENTRY = 'main.d2';
// Visual editing (dragging, handles, drag-to-connect, the selection toolbar, double-click labels, arrow-key moves) is off unless the page is opened
// with `?visual=1`. Selecting, the inspector and the source pane edit without it.
const VISUAL = new URLSearchParams(location.search).get('visual') === '1';
document.body.dataset.visual = VISUAL ? 'on' : 'off';
$('visual-tools').hidden = !VISUAL;
// D2's own default light and dark themes follow the system scheme, as in the demo.
const dark = matchMedia('(prefers-color-scheme: dark)');
// D2's themes (d2themescatalog), for the Theme menu; Auto picks D2's own default light or dark theme.
const THEMES: [number, string][] = [[0, 'Neutral default'], [1, 'Neutral grey'], [3, 'Flagship Terrastruct'], [4, 'Cool classics'], [5, 'Mixed berry blue'], [6, 'Grape soda'], [7, 'Aubergine'], [8, 'Colorblind clear'], [100, 'Vanilla Nitro Cola'], [101, 'Orange creamsicle'], [102, 'Shirley temple'], [103, 'Earth tones'], [104, 'Everglade green'], [105, 'Buttered toast'], [200, 'Dark Mauve'], [201, 'Dark Flagship Terrastruct'], [300, 'Terminal'], [301, 'Terminal Grayscale'], [302, 'Origami'], [303, 'C4']];
const themeSelect = document.getElementById('theme') as HTMLSelectElement, layoutSelect = document.getElementById('layout') as HTMLSelectElement;
const sketchBox = document.getElementById('sketch') as HTMLInputElement;
themeSelect.append(new Option('Auto (follow system)', 'auto'), ...THEMES.map(([id, name]) => new Option(`${name} (${id})`, String(id))));
const render = () => ({ themeId: themeSelect.value === 'auto' ? (dark.matches ? 200 : 0) : +themeSelect.value, sketch: sketchBox.checked, pad: 24, scale: 1, center: false });
const layout = () => layoutSelect.value as Engine;
// D2's shapes (d2target), for the inspector.
const SHAPES = ['rectangle', 'square', 'page', 'parallelogram', 'document', 'cylinder', 'queue', 'package', 'step', 'callout', 'stored_data', 'person', 'diamond', 'oval', 'circle', 'hexagon', 'cloud', 'text', 'code', 'class', 'sql_table', 'image', 'sequence_diagram', 'c4-person', 'hierarchy'];
const START = 'users: Users {shape: person}\napi: API\ndb: Database {shape: cylinder}\nusers -> api: requests\napi -> db: reads\n';
const STORAGE = 'd2editor.text';
let initial = START;
const VIEW = 'd2editor.view';
try {
  initial = localStorage.getItem(STORAGE) ?? START;
  // Restore only values the menus offer.
  const view = JSON.parse(localStorage.getItem(VIEW) ?? '{}');
  for (const [select, value] of [[themeSelect, view.theme], [layoutSelect, view.layout]] as const) if ([...select.options].some(o => o.value === value)) select.value = value;
  sketchBox.checked = view.sketch === true;
} catch { /* storage is optional */ }

// Icons are links the page shows as images (spec 0010 `link` mode), so icon shapes appear without a fetch policy (spec 0015 §3.5).
const client = createClient({ spawn: spawnWorker(), images: { mode: 'link' } });
const view = mount($('host'));
const history = createHistory(initial);
const camera = canvas($('canvas'), $('host'), $('grid'), v => { $('zoom').textContent = `${Math.round(v.k * 100)}%`; placeToolbar(); }, grab);
// Fit the next painted board: on load, an opened file, and a board switch.
let fitNext = true;
// `painted` is the revision the canvas shows.
const state = { text: initial, revision: 0, painted: -1, board: '', result: undefined as CompileResult | undefined, selected: '', connectFrom: '' };
type Range = { start: number; end: number; text: string };
let typing: ReturnType<typeof setTimeout>, idle: ReturnType<typeof setTimeout>, compileRun = 0, previewFrame = 0;
// A startup error (a broken shared link) stays in the status over later compiles until the text, a menu or the board changes.
let notice = '';
// `moved` is a dropped drag (spec 0014): the snap starts that shape from where it was dropped, not from where it was. Past the origin (spec 0016)
// the scene shifts by (ox, oy) and `rect` is where the shape stood on screen, so the camera can keep it there.
let pending: { revision: number; ids: EditResult['ids']; changed: string[]; moved?: { id: string; dx: number; dy: number; ox: number; oy: number; rect: { left: number; top: number } } } | undefined;

function status(message: string, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
  $('status').dataset.state = error ? 'error' : message === 'Compiling…' ? 'busy' : 'ok';
}

// CodeMirror projects the text; history.ts owns undo, and external changes never feed back into setText.
const patchMarks = StateEffect.define<DecorationSet>();
const patchField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    if (transaction.docChanged) marks = Decoration.none;
    for (const effect of transaction.effects) if (effect.is(patchMarks)) marks = effect.value;
    return marks;
  },
  provide: field => EditorView.decorations.from(field),
});
class DeletedMark extends WidgetType {
  constructor(readonly side: boolean) { super(); }
  eq(other: DeletedMark) { return this.side === other.side; }
  toDOM() {
    const span = document.createElement('span');
    span.className = `patch-mark${this.side ? ' side' : ''}`;
    span.textContent = '\u00a0';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}
let syncingSource = false, sourceLinked = false;
const values = sourceValues({ text: () => state.text, setText, push: text => history.push(text) });
const tree = outlineView($<HTMLDetailsElement>('outline'), {
  entry: ENTRY, linked: () => sourceLinked && !state.board,
  jump(id) {
    state.selected = id; caretToSelection(); inspect(); src.focus();
    const node = objectOf(id)?.nodes[0], element = node && $('host').shadowRoot?.querySelector(`[data-id="${CSS.escape(node)}"]`);
    if (element) camera.reveal(element);
  },
  source(offset) { const anchor = sourceOffset(offset); src.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor) }); src.focus(); },
});
const src = new EditorView({
  parent: $('src'),
  doc: initial,
  extensions: [
    EditorState.tabSize.of(2), EditorView.lineWrapping, patchField, sourceLanguage, values.extension, sourceFolds,
    EditorView.contentAttributes.of({ 'aria-label': 'D2 source', spellcheck: 'false' }),
    keymap.of(standardKeymap),
  ],
  dispatchTransactions(transactions, editor) {
    editor.update(transactions);
    if (syncingSource) return;
    if (transactions.some(t => t.docChanged)) setText(editor.state.doc.toString(), { delay: 250 });
    else if (transactions.some(t => t.selection)) selectAtCaret();
  },
});

// CodeMirror counts each displayed newline once; D2 offsets still address the original CRLF text until typing normalises it.
const sourceOffset = (offset: number) => state.text.slice(0, offset).replace(/\r\n?/g, '\n').length;
// An unchanged list is not sent again: each dispatch closes an open hover tooltip, and the idle recompile repeats the same diagnostics.
let shownDiagnostics = '';
function diagnose(diagnostics: Diagnostic[] = []) {
  const list = diagnostics.flatMap(d => d.range && (!d.file || d.file === ENTRY) ? [{
    from: sourceOffset(d.range.start), to: sourceOffset(d.range.end), severity: d.severity, message: d.message,
  }] : []);
  const key = JSON.stringify(list);
  const unfolds = diagnosticUnfolds(src.state, list);
  if (unfolds.length) src.dispatch({ effects: unfolds });
  if (key === shownDiagnostics) return;
  shownDiagnostics = key;
  src.dispatch(setDiagnostics(src.state, list));
}

function mark(edits: Range[] = [], side = new Set<Range>()) {
  let shift = 0;
  const marks = edits.map(e => {
    // Patch ranges address the old text; replacements are marked in the new text.
    const start = e.start + shift, end = start + e.text.length;
    shift += e.text.length - (e.end - e.start);
    return end > start
      ? Decoration.mark({ class: `patch-mark${side.has(e) ? ' side' : ''}` }).range(sourceOffset(start), sourceOffset(end))
      : Decoration.widget({ widget: new DeletedMark(side.has(e)), side: 1 }).range(sourceOffset(start));
  });
  src.dispatch({ effects: patchMarks.of(Decoration.set(marks, true)) });
}

function selectAtCaret() {
  if (!sourceLinked) return;
  const board = boardOf();
  if (!board) return;
  const head = src.state.selection.main.head, line = src.state.doc.lineAt(head);
  const object = objectsAt(board.association, { path: ENTRY, line: line.number - 1, column: head - line.from })[0];
  state.selected = object?.id ?? '';
  tree.current(state.board ? '' : state.selected);
  inspect();
  const node = object && $('host').shadowRoot?.querySelector(`[data-id="${CSS.escape(object.nodes[0])}"]`);
  if (node) camera.reveal(node);
}

function caretToSelection() {
  if (!sourceLinked) return;
  const reference = objectOf(state.selected)?.references[0];
  if (!reference || reference.path !== ENTRY) return;
  const anchor = sourceOffset(reference.start.offset);
  syncingSource = true;
  try { src.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor) }); }
  finally { syncingSource = false; }
  tree.current(state.board ? '' : state.selected);
}

// Top-left on screen of the painted parts under some nodes. Ownership frames can be zero-sized and each path's 1×1 <svg> wrapper sits at the
// scene origin (as in canvas.reveal), so only the other descendants count.
function screenCorner(nodes: Element[]) {
  const rects = nodes.flatMap(el => [el, ...el.querySelectorAll('*')]).filter(e => e.localName !== 'svg').map(e => e.getBoundingClientRect()).filter(r => r.width || r.height);
  return rects.length ? { left: Math.min(...rects.map(r => r.left)), top: Math.min(...rects.map(r => r.top)) } : undefined;
}

// Past the origin the scene's coordinates shift, so the painted board would slide under the author's hand. The snap animates each shape from
// its predicted box, so pan the camera until the dragged shape's start (its natural place minus that animation offset) is where it stood.
function keepInPlace(moved: NonNullable<typeof pending>['moved'] & {}, before: Association, after: Association) {
  const was = before.objects.find(o => o.id === moved.id)?.box, now = after.objects.find(o => o.id === moved.id);
  if (!was || !now?.box) return;
  const elements = [...$('host').shadowRoot!.querySelectorAll<HTMLElement | SVGElement>('[data-id]')];
  const corner = screenCorner(outerNodes(elements, now));
  if (!corner) return;
  const k = camera.view.k;
  camera.pan(moved.rect.left - (corner.left - (now.box.X - was.X) * k), moved.rect.top - (corner.top - (now.box.Y - was.Y) * k));
}

async function compile(seeds?: number[]) {
  sourceLinked = false;
  const revision = state.revision, board = state.board, run = ++compileRun;
  let result: CompileResult;
  try {
    result = await client.compile({ revision, files: { [ENTRY]: state.text }, entry: ENTRY, render: render(), layout: layout(), boards: [board], seeds });
  } catch (error) {
    if (run === compileRun && revision === state.revision && (error as Error).name !== 'SupersededError') status(String(error), true);
    return;
  }
  if (revision !== state.revision || run !== compileRun || revision === dropping) return;
  if (result.error) {
    // A board the text no longer has falls back to the root.
    if (board && !result.available.includes(board)) { state.board = ''; return compile(seeds); }
    diagnose(result.error.diagnostics);
    status(result.error.diagnostics.map(d => `${d.range ? `offset ${d.range.start}: ` : ''}${d.message}`).join('\n') || result.error.message, true);
    return;
  }
  $<HTMLSelectElement>('board').replaceChildren(...result.available.map(path => new Option(path || 'root', path, false, path === state.board)));
  const change = pending?.revision === revision ? pending : undefined, moved = change?.moved;
  const old = state.result?.boards?.find(b => b.path === board)?.association;
  // The prediction in the new scene's coordinates: everything shifted by the overshoot, the dragged shape also by the drag.
  const before = old && moved ? { ...old, objects: old.objects.map(o => o.box ? { ...o, box: { ...o.box, X: o.box.X + moved.ox + (within(o.id, moved.id) ? moved.dx : 0), Y: o.box.Y + moved.oy + (within(o.id, moved.id) ? moved.dy : 0) } } : o) } : old;
  const focused = $('host').shadowRoot?.activeElement?.getAttribute('data-id');
  outline?.remove();
  hideHandles();
  markTarget('');
  for (const el of dragged) el.style.translate = '';
  dragged = [];
  try { await view.update(result, board); } catch (error) { status(String(error), true); return; }
  if (revision !== state.revision || run !== compileRun) return;
  paintCanvas(result.boards!.find(b => b.path === board)!.scene);
  if (fitNext) { fitNext = false; camera.fit(); }
  const after = result.boards!.find(b => b.path === board)!.association;
  if (moved && (moved.ox || moved.oy)) keepInPlace(moved, before!, after);
  if (before) snap($('host').shadowRoot!, before, after, change?.ids, change?.changed);
  pending = undefined;
  state.result = result;
  state.painted = revision;
  values.refresh(src, board ? undefined : boardOf()?.association, ENTRY, state.text);
  tree.refresh(board ? undefined : boardOf()?.association);
  src.dispatch({ effects: replaceFolds.of(bodyRanges(board ? undefined : boardOf()?.association, ENTRY, state.text)) });
  const head = src.state.selection.main.head, line = src.state.doc.lineAt(head);
  tree.current(board ? '' : objectsAt(after, { path: ENTRY, line: line.number - 1, column: head - line.from })[0]?.id ?? '');
  diagnose(result.diagnostics);
  sourceLinked = true;
  if (focused && focused === state.selected) $('host').shadowRoot?.querySelector<HTMLElement>(`[data-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  status(notice || [`compiled in ${Math.round(result.millis)} ms`, ...result.diagnostics.map(d => d.message)].join('\n'), Boolean(notice));
  inspect();
}

// As the demo (packages/d2web/demo): D2 paints the board background as the scene's `root:background` rectangle, which would hide the dots and
// make the board read as a picture on the canvas. The canvas takes that same solid colour and the rectangle is hidden; a gradient or pattern
// background has no single colour, so there the rectangle stays. The dots are black or white ink, whichever contrasts with it.
const sheet = new CSSStyleSheet();
function paintCanvas(scene: SceneDocument) {
  const fill = scene.Root.Children.find(c => c.ID === 'root:background')?.Primitive;
  const paint = fill && 'Fill' in fill ? fill.Fill : null;
  const color = paint?.$ === 'SolidPaint' && /^rgba\(\d+,\d+,\d+,[\d.]+\)$/.test(paint.Color) ? paint.Color : '';
  $('canvas').style.backgroundColor = color;
  const root = $('host').shadowRoot!;
  if (!root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  // The scene's own box clips what leaves the board; a dragged shape must be seen past it (spec 0016).
  sheet.replaceSync(`[data-d2-scene] { overflow: visible !important; }${color ? '[data-id="root:background"] { display: none; }' : ''}`);
  const [r, g, b] = color ? color.match(/\d+/g)!.map(Number) : [];
  $('grid').style.setProperty('--dot-rgb', color ? ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5 ? '0 0 0' : '255 255 255') : '');
}

// Every change of text: typing, a patch, undo, an opened file. Each is a new revision, so older edits and compiles become stale.
function setText(text: string, { record = true, edits, side, delay = 0, preview = false, valueEdit: valueId }: { record?: boolean; edits?: Range[]; side?: Set<Range>; delay?: number; preview?: boolean; valueEdit?: string } = {}) {
  values.close();
  notice = '';
  sourceLinked = false;
  clearTimeout(typing);
  clearTimeout(idle);
  cancelAnimationFrame(previewFrame);
  state.text = text;
  state.revision++;
  if (record) history.push(text);
  const displayed = text.replace(/\r\n?/g, '\n');
  if (src.state.doc.toString() !== displayed) {
    syncingSource = true;
    try { src.dispatch({ changes: textChange(src.state.doc.toString(), displayed), annotations: valueId ? valueEdit.of(valueId) : undefined }); }
    finally { syncingSource = false; }
  }
  diagnose();
  mark(edits, side);
  try { localStorage.setItem(STORAGE, text); } catch { /* storage is optional */ }
  status('Compiling…');
  if (preview) previewFrame = requestAnimationFrame(() => void compile([1]));
  else typing = setTimeout(() => void compile([1]), delay);
  // Seeds are TALA's: other engines need no second compile when the user stops.
  if (layout() === 'tala') idle = setTimeout(() => void compile(), 1000);
}

// One canvas action, one transaction. Only a checked patch changes the text; anything else leaves it as it was.
// `effects` are objects the edit changes only as a side effect: their ranges are marked apart from the author's own (spec 0016).
async function edit(ops: EditOp[], effects: Association['objects'] = [], own?: Association['objects'][number]): Promise<EditResult | undefined> {
  const revision = state.revision, board = state.board, selected = state.selected;
  let result: EditResult;
  try { result = await client.edit({ revision, files: { [ENTRY]: state.text }, entry: ENTRY, board, ops }); }
  catch (error) { if (revision === state.revision && board === state.board) status(`${ops[0].op}: ${String(error)}`, true); return; }
  // Raw typing and board switches invalidate an edit even before a debounced compile reaches the client.
  if (revision !== state.revision || board !== state.board) return;
  if (result.patch) {
    follow(result.ids);
    pending = { revision: revision + 1, ids: result.ids, changed: [selected] };
    const spans = (objects: typeof effects) => objects.flatMap(o => [...o.references, ...Object.values(o.properties).flatMap(p => (p.source ? [p.source] : []))]);
    const touches = (e: Range, objects: typeof effects) => spans(objects).some(s => (e.start < s.end.offset && e.end > s.start.offset) || (e.start === e.end && e.start >= s.start.offset && e.start <= s.end.offset));
    // One range can cover both (adjacent declarations): it is the author's.
    setText(result.patch.text, { edits: result.patch.edits, side: new Set(result.patch.edits.filter(e => touches(e, effects) && !(own && touches(e, [own])))) });
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
  caretToSelection();
  inspect();
}
view.on('click', e => select(e.id));

// Dragging a shape (spec 0014, spec 0015 §3.3). The shape under the pointer comes from mount's hover events; a press on it previews the move by
// translating its painted nodes (and its children's). Released over another receiving container (or out to the root) it moves there with
// `move`; released in its own parent it takes D2's `top` and `left` on TALA, and returns on other engines, which ignore positions.
// `dropping` is the revision a dropped shape is being edited against: a compile of that text finishing meanwhile (the idle one, say) must not repaint
// and wipe the dropped shape's preview; the edit's own compile follows.
let dropping = -1;
let hovered = '', dragged: (HTMLElement | SVGElement)[] = [];
view.on('hover', e => {
  if (e.domEvent.type === 'pointerover') hovered = e.id;
  else if (hovered === e.id) hovered = '';
  showHandles();
});
const within = (id: string, ancestor: string) => id === ancestor || id.startsWith(`${ancestor}.`);
const boardOf = () => state.result?.boards?.find(b => b.path === state.board);

// The scene's coordinate parent: where D2's boxes are laid out, as the selection outline uses (snap.ts).
function sceneParent() {
  const board = boardOf(), root = $('host').shadowRoot;
  const id = board?.association.objects.find(o => o.nodes.length)?.nodes[0];
  return id ? root?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.parentElement ?? undefined : undefined;
}
// A client point in scene coordinates, measured from a zero-size probe at the scene origin.
function toScene(cx: number, cy: number) {
  const parent = sceneParent();
  if (!parent) return;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0';
  parent.append(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  return { x: (cx - r.left) / camera.view.k, y: (cy - r.top) / camera.view.k };
}
// Editor chrome in the scene's coordinate parent: a target outline, the rubber band, the handles. d2web paints none of it.
function chrome(className: string, css: string, tag = 'div') {
  const el = tag === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement(tag);
  el.setAttribute('class', className);
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('style', `position:absolute;${css}`);
  sceneParent()?.append(el);
  return el;
}
let target: Element | undefined;
function markTarget(id: string) {
  target?.remove();
  const box = id ? objectOf(id)?.box : undefined;
  target = box ? chrome('drop-target', `pointer-events:none;left:${box.X}px;top:${box.Y}px;width:${box.Width}px;height:${box.Height}px;outline:2px dashed #3975d5;outline-offset:2px;background:rgb(57 117 213 / 0.08)`) : undefined;
}

function retarget(dot: HTMLElement, e: PointerEvent): Grab | undefined {
  const board = boardOf(), id = state.selected, object = objectOf(id), start = toScene(e.clientX, e.clientY);
  if (!board || !object || !start) return;
  const side = dot.dataset.end as 'source' | 'target', fixed = endDots.find(d => d !== dot)!, ctx = { board: board.association, engine: layout() };
  const band = chrome('rubber-band', 'left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none', 'svg');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  for (const [k, v] of Object.entries({ stroke: '#3975d5', 'stroke-width': String(2 / camera.view.k), 'stroke-dasharray': `${6 / camera.view.k} ${4 / camera.view.k}` })) line.setAttribute(k, v);
  band.append(line);
  let to = '';
  const end = () => { band.remove(); markTarget(''); };
  return {
    move(dx, dy) {
      const x = start.x + dx, y = start.y + dy;
      for (const [k, v] of Object.entries({ x1: fixed.dataset.x!, y1: fixed.dataset.y!, x2: String(x), y2: String(y) })) line.setAttribute(k, v);
      to = connectTarget(ctx, x, y, 12 / camera.view.k);
      markTarget(to && to !== (side === 'source' ? object.src : object.dst) ? to : '');
    },
    cancel: end,
    drop() {
      end();
      if (!to || to === (side === 'source' ? object.src : object.dst)) return;
      void edit([{ op: 'reconnect', key: id, ...(side === 'source' ? { src: to } : { dst: to }) }]);
    },
  };
}

function grab(e: PointerEvent): Grab | undefined {
  if (!VISUAL) return;
  const dot = (e.composedPath()[0] as Element | undefined)?.closest?.('.end-dot');
  if (dot) return retarget(dot as HTMLElement, e);
  const handle = (e.composedPath()[0] as Element | undefined)?.closest?.('.handle');
  const object = objectOf(handle ? (handle as HTMLElement).dataset.from! : hovered), board = boardOf();
  if (!board) return;
  const ctx = { board: board.association, engine: layout() };
  const action = press(object, ctx, handle ? 'handle' : 'body');
  if (action === 'connect') return connectFrom(handle as HTMLElement, e);
  const start = toScene(e.clientX, e.clientY);
  if (action === 'pan' || !object || !start) return;
  const objects = board.association.objects, parent = object.parent ?? '';
  const elements = [...$('host').shadowRoot!.querySelectorAll<HTMLElement | SVGElement>('[data-id]')];
  const nodes = objects.filter(o => within(o.id, object.id)).flatMap(o => outerNodes(elements, o));
  const parentBox = objects.find(o => o.id === parent)?.box;
  let into = parent;
  const reset = () => { markTarget(''); for (const el of nodes) el.style.translate = ''; };
  // A message moves up or down the diagram: dropped between two others it takes that place.
  if (object.kind === 'connection') {
    const diagram = diagramOf(object, ctx), messages = objects.filter(o => o.kind === 'connection' && diagramOf(o, ctx) === diagram), middle = (o: typeof object) => o.box!.Y + o.box!.Height / 2;
    let before: string | undefined | null = null;
    return {
      move(_dx, dy) {
        dragged = nodes;
        for (const el of nodes) el.style.translate = `0 ${dy}px`;
        const y = start.y + dy, rest = messages.filter(m => m.id !== object.id && m.box);
        before = rest.find(m => middle(m) > y)?.id;
        const at = messages.findIndex(m => m.id === object.id);
        if (before === messages[at + 1]?.id) before = null;
        markTarget(before ?? '');
      },
      cancel: reset,
      drop() {
        markTarget('');
        state.selected = object.id;
        if (before === null) return reset();
        dropping = state.revision;
        void edit([{ op: 'reorder', key: object.id, ...(before ? { before } : {}) }]).then(() => { dropping = -1; reset(); });
      },
    };
  }
  // Cells of a grid and actors of a sequence diagram have no free position: dropping one on a sibling puts it there (spec 0019 `reorder`).
  if (action === 'reorder') {
    const siblings = objects.filter(o => (o.parent ?? '') === parent);
    let over = '';
    return {
      move(dx, dy) {
        dragged = nodes;
        hideHandles();
        for (const el of nodes) el.style.translate = `${dx}px ${dy}px`;
        const x = start.x + dx, y = start.y + dy;
        over = siblings.find(o => o.id !== object.id && o.box && x >= o.box.X && x <= o.box.X + o.box.Width && y >= o.box.Y && y <= o.box.Y + o.box.Height)?.id ?? '';
        markTarget(over);
      },
      cancel: reset,
      drop() {
        markTarget('');
        state.selected = object.id;
        if (!over) return reset();
        // Dropped on an earlier sibling it goes before it; on a later one, after it.
        const at = siblings.findIndex(o => o.id === object.id), to = siblings.findIndex(o => o.id === over);
        const before = to < at ? over : siblings[to + 1]?.id;
        dropping = state.revision;
        void edit([{ op: 'reorder', key: object.id, ...(before ? { before } : {}) }]).then(() => { dropping = -1; reset(); });
      },
    };
  }
  return {
    move(dx, dy) {
      dragged = nodes;
      hideHandles();
      for (const el of nodes) el.style.translate = `${dx}px ${dy}px`;
      const hit = dropTarget(ctx, start.x + dx, start.y + dy, object.id);
      // Spec 0016: to the root or an ancestor is a reparent only once the shape is fully out of its container; until then it is a shift.
      into = parentBox && object.box && (hit === '' || within(parent, hit)) && !leaves(object.box, parentBox, dx, dy) ? parent : hit;
      markTarget(into === parent ? '' : into);
    },
    cancel: reset,
    drop(dx, dy) {
      markTarget('');
      state.selected = object.id;
      dropping = state.revision;
      if (into !== parent) { void edit([{ op: 'move', key: object.id, parent: into }]).then(result => { dropping = -1; if (!result) reset(); }); return; }
      if (!movable.applies(object, { board: board.association, engine: layout() })) { dropping = -1; reset(); status('Positions need the TALA layout engine; drop a shape into a zone to move it there.'); return; }
      const at = placeShifting(objects, object.id, dx, dy)!;
      const rect = screenCorner(nodes);
      const ops = moveOps(object.id, at);
      void edit(ops, objects.filter(o => at.siblings.some(s => s.id === o.id)), object).then(result => {
        dropping = -1;
        if (!result) return reset();
        if (pending) pending.moved = { id: object.id, dx, dy, ox: at.ox, oy: at.oy, rect: rect! };
      });
    },
  };
}

// Drag to connect (spec 0015 §3.4): four handles at the hovered shape's edge midpoints. A drag from one draws a rubber band; released on a shape
// (or within 12 screen px of one) it connects; released elsewhere it creates a shape there, inside the receiving container under the pointer.
let handles: Element[] = [], handleFor = '', overHandle = false, hideTimer: ReturnType<typeof setTimeout> | undefined, connectAbort: (() => void) | undefined;
function hideHandles() { for (const h of handles) h.remove(); handles = []; handleFor = ''; }
function showHandles() {
  clearTimeout(hideTimer);
  if (!VISUAL) return;
  const object = objectOf(hovered), board = boardOf();
  if (!object || !board || !hasHandle.applies(object, { board: board.association, engine: layout() }) || !object.box) {
    // Moving onto a handle leaves the shape: keep its handles a moment so the pointer can reach them.
    hideTimer = setTimeout(() => { if (!overHandle && !hovered) hideHandles(); }, 150);
    return;
  }
  if (handleFor === object.id || dragged.length) return;
  hideHandles();
  handleFor = object.id;
  const { X, Y, Width: W, Height: H } = object.box, size = 14 / camera.view.k;
  handles = [[X + W / 2, Y], [X + W, Y + H / 2], [X + W / 2, Y + H], [X, Y + H / 2]].map(([x, y]) => {
    const h = chrome('handle', `left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;border-radius:50%;background:#fff;border:${2 / camera.view.k}px solid #3975d5;box-sizing:border-box;cursor:crosshair;pointer-events:auto`) as HTMLElement;
    Object.assign(h.dataset, { x, y, from: object.id });
    h.addEventListener('pointerenter', () => { overHandle = true; });
    h.addEventListener('pointerleave', () => { overHandle = false; showHandles(); });
    return h;
  });
}
function connectFrom(handle: HTMLElement, e: PointerEvent): Grab | undefined {
  const board = boardOf(), from = handle.dataset.from!, x0 = +handle.dataset.x!, y0 = +handle.dataset.y!, start = toScene(e.clientX, e.clientY);
  if (!board || !start) return;
  const ctx = { board: board.association, engine: layout() }, objects = board.association.objects;
  const band = chrome('rubber-band', 'left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none', 'svg');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('stroke', '#3975d5');
  line.setAttribute('stroke-width', String(2 / camera.view.k));
  line.setAttribute('stroke-dasharray', `${6 / camera.view.k} ${4 / camera.view.k}`);
  band.append(line);
  let to = '', at = start, aborted = false;
  const end = () => { band.remove(); markTarget(''); connectAbort = undefined; };
  connectAbort = () => { aborted = true; end(); };
  return {
    move(dx, dy) {
      if (aborted) return;
      at = { x: start.x + dx, y: start.y + dy };
      line.setAttribute('x1', String(x0)); line.setAttribute('y1', String(y0)); line.setAttribute('x2', String(at.x)); line.setAttribute('y2', String(at.y));
      to = connectTarget(ctx, at.x, at.y, 12 / camera.view.k);
      markTarget(to && to !== from ? to : '');
    },
    cancel: end,
    drop() {
      end();
      if (aborted || to === from) return;
      if (to) { void edit([{ op: 'create', key: `${from} -> ${to}` }]).then(r => { if (r) select(r.ids.created[0] ?? to); }); return; }
      const key = freeKey(objects, dropTarget(ctx, at.x, at.y), 'shape');
      void (async () => {
        const result = await edit([{ op: 'create', key }, { op: 'create', key: `${from} -> ${key}` }]);
        if (!result) return;
        state.selected = key;
        await compiled();
        const input = $('rename').querySelector('input') as HTMLInputElement;
        input.focus();
        input.select();
      })();
    },
  };
}
view.on('focus', e => { if (camera.pressed) return; state.selected = e.id; caretToSelection(); camera.reveal(e.domEvent.target as Element); inspect(); });

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

// A selected connection shows a dot at each end; dragging one onto another shape retargets that end (spec 0019 `reconnect`).
let endDots: HTMLElement[] = [];
function markEnds(object: ReturnType<typeof objectOf>) {
  for (const dot of endDots) dot.remove();
  endDots = [];
  const node = VISUAL && object?.kind === 'connection' && $('host').shadowRoot?.querySelector(`[data-id="${CSS.escape(object.nodes[0])}"]`);
  const paths = node ? [...node.querySelectorAll('path')] : [];
  const line = paths.sort((a, b) => b.getTotalLength() - a.getTotalLength())[0];
  if (!line || !line.getScreenCTM()) return;
  const size = 14 / camera.view.k, length = line.getTotalLength();
  endDots = (['source', 'target'] as const).flatMap(end => {
    const local = line.getPointAtLength(end === 'source' ? 0 : length), client = new DOMPoint(local.x, local.y).matrixTransform(line.getScreenCTM()!), at = toScene(client.x, client.y);
    if (!at) return [];
    const dot = chrome('end-dot', `left:${at.x - size / 2}px;top:${at.y - size / 2}px;width:${size}px;height:${size}px;border-radius:50%;background:#fff;border:${2 / camera.view.k}px solid #3975d5;box-sizing:border-box;cursor:grab;pointer-events:auto`) as HTMLElement;
    Object.assign(dot.dataset, { end, x: at.x, y: at.y });
    return [dot];
  });
}

// The toolbar sits on the selection's outline in screen space (it does not scale with zoom) and follows pan, zoom and repaints.
function placeToolbar() {
  const bar = $('toolbar'), object = objectOf(state.selected), at = outline?.getBoundingClientRect(), page = $('canvas').getBoundingClientRect();
  bar.hidden = !VISUAL || !object || !at || !object.box;
  if (bar.hidden || !at || !object) return;
  const edge = object.kind === 'connection';
  bar.querySelector<HTMLElement>('[data-tool="fill"]')!.hidden = edge;
  const width = bar.offsetWidth, top = at.top - page.top - bar.offsetHeight - 10;
  bar.style.top = `${top < 4 ? at.bottom - page.top + 10 : top}px`;
  bar.style.left = `${Math.max(4, Math.min(page.width - width - 4, at.left - page.left + at.width / 2 - width / 2))}px`;
  for (const tool of ['fill', 'stroke']) {
    const hex = object.properties[tool]?.value ?? '', input = bar.querySelector<HTMLInputElement>(`[data-tool="${tool}"] input`)!;
    if (/^#[0-9a-f]{6}$/i.test(hex)) input.value = hex;
  }
}
$('toolbar').addEventListener('change', event => {
  const input = event.target as HTMLInputElement, tool = input.closest<HTMLElement>('[data-tool]')?.dataset.tool;
  if (tool && state.selected) void edit([{ op: 'set', key: `${state.selected}.style.${tool}`, value: input.value }]);
});
$('tool-delete').addEventListener('click', () => { if (state.selected) void edit([{ op: 'delete', key: state.selected }]); });

// Double-click edits a shape's label where it is drawn: Enter or leaving saves, Escape cancels. A text node edits in the inspector.
$('canvas').addEventListener('dblclick', () => {
  if (!VISUAL) return;
  const object = objectOf(state.selected), parent = sceneParent();
  if (!object?.box || object.kind !== 'shape' || !parent) return;
  if (kindOf(object)?.id === 'text') { ($<HTMLFormElement>('props').elements.namedItem('content') as HTMLTextAreaElement).focus(); return; }
  if (kindOf(object)?.id !== 'shape') return;
  const { X, Y, Width, Height } = object.box, input = document.createElement('input');
  input.className = 'label-edit';
  input.value = object.label;
  input.setAttribute('aria-label', `Label of ${object.id}`);
  input.style.cssText = `left:${X}px;top:${Y + Height / 2 - 16}px;width:${Math.max(Width, 80)}px;height:32px`;
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    input.remove();
    if (save && input.value !== object.label) void edit([{ op: 'set', key: object.id, value: input.value }]);
  };
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => finish(true));
  parent.append(input);
  input.select();
  input.focus();
});

// The layered inspector (ADR 0015, spec 0018): the sections of the selection's inheritance chain, only the controls D2 honours for it.
// `shown` is every generated field on screen; the edits go through setOps over them.
let shown: Field[] = [];
const HAND = new Set(['label', 'shape', 'icon', 'fill', 'stroke', 'language', 'content']);
function inspect() {
  const object = objectOf(state.selected);
  highlight(object);
  markEnds(object);
  placeToolbar();
  $('inspector').hidden = !object;
  $('no-selection').hidden = Boolean(object);
  if (!object) return;
  const form = $<HTMLFormElement>('props');
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const sections = sectionsOf(object), kind = kindOf(object), caps = capabilities(object, { board: boardOf()!.association, engine: layout(), entry: ENTRY }), ends = caps.endpoints;
  $('selected').replaceChildren(Object.assign(document.createElement('span'), { className: 'kind', textContent: object.kind === 'connection' ? 'Connection' : kind?.label ?? 'Node' }), ` ${object.id}`);
  // A section is shown when the chain has it; its controls are placed in order, then the generated ones, and a control D2 ignores here is absent.
  const applies = (keyword: string) => caps.fields.find(f => f.keyword === keyword)?.available ?? true;
  shown = [];
  const placed = new Set<Element>();
  for (const el of form.querySelectorAll<HTMLElement>('[data-section]')) {
    const section = sections.find(s => s.id === el.dataset.section);
    el.hidden = !section;
    if (!section) { el.querySelector('.actions')?.replaceChildren(); continue; }
    let cursor: Element = el.querySelector('h3')!;
    for (const { keyword } of section.controls.filter(c => HAND.has(c.keyword))) {
      const control = form.querySelector<HTMLElement>(`[data-keyword="${keyword}"]`)!;
      placed.add(control);
      cursor.after(control);
      cursor = control;
      control.hidden = !applies(keyword) || (keyword === 'language' && object.content !== 'code');
    }
    const controls: Record<string, Control> = {};
    const fields = section.controls.filter(c => !HAND.has(c.keyword)).flatMap(c => {
      const f = caps.fields.find(f => f.keyword === c.keyword);
      if (f?.available) controls[f.path] = c;
      return f?.available ? [f] : [];
    });
    shown.push(...fields);
    renderFields(el.querySelector<HTMLElement>('.fields')!, fields, controls);
    // A table or class edits its rows in place.
    const flavor = kinds.find(k => k.section.id === section.id)?.rows;
    if (flavor) renderRows(el.querySelector<HTMLElement>('.rows')!, object, flavor, ops => void edit(ops));
    // A kind's actions are buttons under its controls, only where they apply.
    const host = el.querySelector<HTMLElement>('.actions') ?? el.appendChild(Object.assign(document.createElement('div'), { className: 'actions' }));
    host.replaceChildren(...actionsOf(section.id).filter(a => a.when?.(object, boardOf()!.association) ?? true)
      .map(a => Object.assign(document.createElement('button'), { type: 'button', textContent: a.label, onclick: () => void edit(a.ops(object, boardOf()!.association)) })));
  }
  // Hand-built controls no section lists are not shown, and none is ever disabled.
  for (const el of form.querySelectorAll<HTMLElement>('[data-keyword]')) if (!placed.has(el)) el.hidden = true;
  for (const name of ['label', 'fill', 'stroke']) {
    if (document.activeElement !== field(name)) field(name).value = object.properties[name]?.value ?? (name === 'label' ? object.label : '');
  }
  // The pickers follow the text field when it holds a hex colour; D2 theme codes and names leave the picker dimmed.
  for (const picker of form.querySelectorAll<HTMLInputElement>('input[type=color]')) {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(field(picker.dataset.for!).value) ? field(picker.dataset.for!).value : '';
    picker.value = hex.length === 4 ? `#${[...hex.slice(1)].map(c => c + c).join('')}` : hex || '#000000';
    picker.classList.toggle('unset', !hex);
  }
  // The Text surface (ADR 0015): the words as a multi-line editor, and the format as a switch.
  const content = form.elements.namedItem('content') as HTMLTextAreaElement;
  if (document.activeElement !== content) content.value = object.label;
  $('text-tag').replaceChildren(...(kind?.id === 'text' ? TEXT_FORMATS.map(([label, which]) => Object.assign(document.createElement('button'), { type: 'button', textContent: label, onclick: () => setFormat(object.id, which) })) : []));
  TEXT_FORMATS.forEach(([, which], i) => $('text-tag').children[i]?.setAttribute('aria-pressed', String(object.content === which)));
  if (document.activeElement !== shapeSelect) shapeSelect.value = object.properties.shape?.value ?? '';
  if (document.activeElement !== field('icon')) field('icon').value = object.image && object.image.role !== 'edge-icon' ? object.image.source : object.properties.icon?.value ?? '';
  if (document.activeElement !== field('language')) field('language').value = object.language ?? '';
  // The Type picker (ADR 0015): any registered node kind to any other, one edit. A node whose kind has no descriptor yet cannot be converted safely.
  $('type').hidden = !kind;
  $('type').replaceChildren(...(kind ? kinds.map(k => Object.assign(document.createElement('button'), { type: 'button', textContent: k.label, onclick: () => retype(object.id, k.id) })) : []));
  for (const b of $('type').children) b.setAttribute('aria-pressed', String(b.textContent === kind?.label));
  // A connection names its ends; each is a button that selects it.
  $('endpoints').hidden = !ends;
  $('endpoints').replaceChildren(...(ends ? (['source', 'target'] as const).map(side => Object.assign(document.createElement('button'), { type: 'button', textContent: `${side === 'source' ? 'From' : 'To'}: ${ends[side]}`, onclick: () => select(ends[side]) })) : []));
  const name = $('rename').querySelector('input') as HTMLInputElement;
  if (document.activeElement !== name) name.value = object.id.split('.').pop()!;
}

// Languages D2's highlighter knows (exported from D2 at build, keywords.json), the common ones first; any other tag can still be typed.
$('languages').append(...[...keywordTable.commonLanguages, ...keywordTable.languages.filter(l => !keywordTable.commonLanguages.includes(l))].map(l => new Option(l, l)));
const TEXT_FORMATS = [['Markdown', 'markdown'], ['Code', 'code'], ['LaTeX', 'latex']] as const;
const tagOf = (content: string, language?: string) => (content === 'code' ? language || 'python' : content === 'latex' ? 'latex' : 'md');
function setFormat(id: string, content: (typeof TEXT_FORMATS)[number][1]) {
  const object = objectOf(id);
  if (object && object.content !== content) void edit([{ op: 'set', key: id, value: object.label, tag: tagOf(content) }]);
}

// A small confirmation sheet; resolves true on the primary button.
function confirmSheet(title: string, body: string) {
  const dialog = $<HTMLDialogElement>('confirm');
  $('confirm-title').textContent = title;
  $('confirm-body').textContent = body;
  dialog.returnValue = 'cancel';
  dialog.showModal();
  return new Promise<boolean>(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
}

async function retype(id: string, to: string) {
  const object = objectOf(id), target = kinds.find(k => k.id === to), board = boardOf();
  if (!object || !target || !board || kindOf(object) === target) return;
  const { ops, loss } = convert(object, target, board.association);
  if (loss.length && !(await confirmSheet(`Change ${id} to ${target.label}?`, `This removes ${loss.join(', ')}. You can undo it.`))) return;
  void edit(ops);
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
  const id = state.selected, value = input.name === 'label' || input.name === 'content' ? input.value : input.value.trim() || null;
  if (input.name === 'content') { const o = objectOf(id); if (o && value !== o.label) void edit([{ op: 'set', key: id, value, tag: tagOf(o.content ?? 'markdown', o.language) }]); return; }
  // A code block's language is its tag, so the code is written again with the new one.
  if (input.name === 'language') { if (value) void edit([{ op: 'set', key: id, value: objectOf(id)!.label, tag: value }]); return; }
  const key = { label: id, fill: `${id}.style.fill`, stroke: `${id}.style.stroke`, shape: `${id}.shape`, icon: `${id}.icon` }[input.name];
  if (key) void edit([{ op: 'set', key, value }]);
});
// Generated fields: a control's data-path names its field; a blank value (or an unchecked toggle) removes the declaration, and top/left travel together.
for (const host of document.querySelectorAll<HTMLElement>('.fields')) {
  host.addEventListener('change', event => {
    const input = event.target as HTMLInputElement, f = shown.find(f => f.path === input.dataset.path);
    if (f) void edit(setOps(f, input.type === 'checkbox' ? (input.checked ? input.dataset.on! : '') : input.value, shown));
  });
  host.addEventListener('click', event => {
    const f = shown.find(f => f.path === (event.target as HTMLElement).dataset.reset);
    if (f) void edit(setOps(f, '', shown));
  });
}
// Text editor keys: Enter is a new line, Cmd/Ctrl+Enter saves (by leaving the field, which commits), Escape cancels.
($<HTMLFormElement>('props').elements.namedItem('content') as HTMLTextAreaElement).addEventListener('keydown', event => {
  const area = event.target as HTMLTextAreaElement;
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); area.blur(); }
  if (event.key === 'Escape') area.value = objectOf(state.selected)?.label ?? '';
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
// Whether arrow keys can move this object; off TALA they say why instead of doing nothing.
function connectableMove(object: NonNullable<ReturnType<typeof objectOf>>, board: NonNullable<ReturnType<typeof boardOf>>) {
  if (object.kind !== 'shape') return false;
  if (movable.applies(object, { board: board.association, engine: layout() })) return true;
  status('Positions need the TALA layout engine; use Tab and the inspector, or drop a shape into a zone.');
  return false;
}
const typingIn = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { connectAbort?.(); connecting(false); select(''); return; }
  // Figma-style view keys outside text fields: +/- zoom, Shift+1 fit, Shift+0 100%.
  if (!typingIn(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const action = { '+': () => camera.zoomBy(1.25), '=': () => camera.zoomBy(1.25), '-': () => camera.zoomBy(0.8), '!': () => camera.fit(), ')': () => camera.reset() }[event.key];
    if (action) { event.preventDefault(); action(); return; }
  }
  // Arrow keys move the focused shape like a drag does (spec 0017 §3.4); a keyboard user has no other way to place one.
  const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (VISUAL && arrow && event.target === $('host') && state.selected && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const board = boardOf(), object = objectOf(state.selected);
    if (board && object && connectableMove(object, board)) {
      event.preventDefault();
      const n = event.shiftKey ? 1 : NUDGE, at = placeShifting(board.association.objects, object.id, arrow[0] * n, arrow[1] * n);
      if (at) void edit(moveOps(object.id, at), board.association.objects.filter(o => at.siblings.some(s => s.id === o.id)), object);
    }
    return;
  }
  if (event.key === 'Enter' && event.target === $('host') && state.connectFrom) { event.preventDefault(); select(state.selected); return; }
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || $<HTMLDialogElement>('unchecked').open) return;
  event.preventDefault();
  step(event.shiftKey ? history.redo() : history.undo());
});

$<HTMLSelectElement>('board').addEventListener('change', event => { values.close(); values.refresh(src, undefined, ENTRY, state.text); state.board = (event.target as HTMLSelectElement).value; state.selected = ''; notice = ''; fitNext = true; connecting(false); pending = undefined; status('Compiling…'); void compile([1]); });

function openText(text: string) {
  values.close();
  history.reset(text);
  state.board = '';
  fitNext = true;
  state.selected = '';
  connecting(false);
  setText(text, { record: false });
}
$<HTMLInputElement>('open').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0], revision = state.revision;
  if (!file) return;
  try { const text = await file.text(); if (revision === state.revision) openText(text); }
  catch (error) { status(`Open: ${String(error)}`, true); }
  input.value = '';
});
$('download').addEventListener('click', () => {
  // The view normalises CRLF; retain the document's line endings until the user types or accepts an edit.
  const url = URL.createObjectURL(new Blob([state.text], { type: 'text/plain;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'diagram.d2' });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

dark.addEventListener('change', () => { if (themeSelect.value === 'auto') { status('Compiling…'); void compile(); } });
// A new engine changes the geometry, so the board is fitted again; a theme keeps the view.
for (const select of [themeSelect, layoutSelect, sketchBox]) select.addEventListener('change', () => {
  try { localStorage.setItem(VIEW, JSON.stringify({ theme: themeSelect.value, layout: layoutSelect.value, sketch: sketchBox.checked })); } catch { /* storage is optional */ }
  if (select === layoutSelect) fitNext = true;
  notice = '';
  status('Compiling…');
  void compile();
});
// A shared link (`?script=` in D2's URL encoding, with optional `layout`, `theme` and `sketch`) opens on top of this browser's text, so Undo brings that
// text back. The query is then dropped, so a reload keeps the user's edits rather than resetting to the link.
const params = new URLSearchParams(location.search);
let shared: string | undefined, sharedError = '';
if (params.has('script')) {
  try { shared = await decodeScript(params.get('script')!); } catch (error) { sharedError = `The shared link could not be opened: ${(error as Error).message}`; }
  for (const [select, value] of [[themeSelect, params.get('theme')], [layoutSelect, params.get('layout')]] as const) if ([...select.options].some(o => o.value === value)) select.value = value!;
  if (params.has('sketch')) sketchBox.checked = params.get('sketch') === '1';
  window.history.replaceState(null, '', location.pathname + (VISUAL ? '?visual=1' : '') + location.hash);
}

setText(initial, { record: false });
if (shared !== undefined && shared !== initial) setText(shared);
if (sharedError) status(notice = sharedError, true);

$('share').addEventListener('click', async () => {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('script', await encodeScript(state.text));
  if (VISUAL) url.searchParams.set('visual', '1');
  url.searchParams.set('layout', layoutSelect.value);
  if (themeSelect.value !== 'auto') url.searchParams.set('theme', themeSelect.value);
  if (sketchBox.checked) url.searchParams.set('sketch', '1');
  try { await navigator.clipboard.writeText(url.href); status(`Link copied (${url.href.length} characters)`); }
  catch { status(`Copy this link: ${url.href}`); }
});
