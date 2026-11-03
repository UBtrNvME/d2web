// d2editor (spec 0013): the D2 text is the only document; canvas actions become d2web edits (spec 0012) and land in it as checked patches.
import { createClient, getObject, type Association, mount, spawnWorker, type CompileResult, type EditOp, type EditResult, type Engine, type SceneDocument } from '../../d2web/src/index.ts';
import { createHistory } from './history.ts';
import { outerNodes, snap } from './snap.ts';
import { canvas, type Grab } from './canvas.ts';
import { leaves, placeShifting } from './position.ts';
import { connectTarget, dropTarget, entries, freeKey, receives, type Entry } from './palette.ts';
import { hasHandle, movable, press } from './traits.ts';
import { decodeScript, encodeScript } from './share.ts';
import { capabilities, setOps, type Field } from './capabilities.ts';
import { HAND_BUILT, renderActions, renderFields } from './inspector.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const src = $<HTMLTextAreaElement>('src');
const ENTRY = 'main.d2';
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

// Icons are links the page shows as images (spec 0010 `link` mode), so palette icons appear without a fetch policy (spec 0015 §3.5).
const client = createClient({ spawn: spawnWorker(), images: { mode: 'link' } });
const view = mount($('host'));
const history = createHistory(initial);
const camera = canvas($('canvas'), $('host'), $('grid'), v => { $('zoom').textContent = `${Math.round(v.k * 100)}%`; }, grab);
// Fit the next painted board: on load, an opened file, and a board switch.
let fitNext = true;
// `painted` is the revision the canvas shows.
const state = { text: initial, revision: 0, painted: -1, board: '', result: undefined as CompileResult | undefined, selected: '', connectFrom: '' };
type Range = { start: number; end: number; text: string };
let typing: ReturnType<typeof setTimeout>, idle: ReturnType<typeof setTimeout>, compileRun = 0;
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

// The last patch's ranges, marked in a copy of the text behind the transparent textarea.
function mark(edits: Range[] = [], side = new Set<Range>()) {
  const marks = $('marks');
  marks.replaceChildren();
  let at = 0, shift = 0;
  for (const e of edits) {
    // Ranges are against the text before the patch; in the new text each starts after the earlier replacements.
    const start = e.start + shift, end = start + e.text.length;
    marks.append(state.text.slice(at, start), Object.assign(document.createElement('mark'), { textContent: state.text.slice(start, end) || ' ', className: side.has(e) ? 'side' : '' }));
    at = end;
    shift += e.text.length - (e.end - e.start);
  }
  marks.append(state.text.slice(at) + '\n');
  marks.scrollTop = src.scrollTop;
}
src.addEventListener('scroll', () => { $('marks').scrollTop = src.scrollTop; });

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
  classButtons(after.classes);
  if (focused && focused === state.selected) $('host').shadowRoot?.querySelector<HTMLElement>(`[data-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  status(notice || `compiled in ${Math.round(result.millis)} ms`, Boolean(notice));
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
function setText(text: string, { record = true, edits, side, delay = 0 }: { record?: boolean; edits?: Range[]; side?: Set<Range>; delay?: number } = {}) {
  notice = '';
  clearTimeout(typing);
  clearTimeout(idle);
  state.text = text;
  state.revision++;
  if (record) history.push(text);
  if (src.value !== text) src.value = text;
  mark(edits, side);
  try { localStorage.setItem(STORAGE, text); } catch { /* storage is optional */ }
  status('Compiling…');
  typing = setTimeout(() => void compile([1]), delay);
  // Seeds are TALA's: other engines need no second compile when the user stops.
  if (layout() === 'tala') idle = setTimeout(() => void compile(), 1000);
}

src.addEventListener('input', () => setText(src.value, { delay: 250 }));

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

function grab(e: PointerEvent): Grab | undefined {
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
      const pin = (id: string, top: number, left: number): EditOp[] => [{ op: 'set', key: `${id}.top`, value: String(top) }, { op: 'set', key: `${id}.left`, value: String(left) }];
      const ops = [...pin(object.id, at.top, at.left), ...at.siblings.flatMap(s => pin(s.id, s.top, s.left))];
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

// The fields the inspector lists now; the generated controls edit through setOps over them (spec 0017).
let shown: Field[] = [];
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
  for (const el of form.querySelectorAll<HTMLElement>('[data-code-only]')) el.hidden = object.content !== 'code';
  if (document.activeElement !== field('icon')) field('icon').value = object.image && object.image.role !== 'edge-icon' ? object.image.source : '';
  if (document.activeElement !== field('language')) field('language').value = object.language ?? '';
  const caps = capabilities(object, { board: boardOf()!.association, engine: layout(), entry: ENTRY }), ends = caps.endpoints;
  shown = caps.fields.filter(f => !HAND_BUILT.has(f.keyword));
  // A connection names its ends; each is a button that selects it.
  $('endpoints').hidden = !ends;
  $('endpoints').replaceChildren(...(ends ? (['source', 'target'] as const).map(side => Object.assign(document.createElement('button'), { type: 'button', textContent: `${side === 'source' ? 'From' : 'To'}: ${ends[side]}`, onclick: () => select(ends[side]) })) : []));
  renderFields($('fields'), shown);
  renderActions($('actions'), caps.actions);
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
  // A code block's language is its tag, so the code is written again with the new one.
  if (input.name === 'language') { if (value) void edit([{ op: 'set', key: id, value: objectOf(id)!.label, tag: value }]); return; }
  const key = { label: id, fill: `${id}.style.fill`, stroke: `${id}.style.stroke`, shape: `${id}.shape`, icon: `${id}.icon` }[input.name];
  if (key) void edit([{ op: 'set', key, value }]);
});
// Generated fields (spec 0017): a control's data-path names its field; a blank value removes the declaration, and top/left travel together.
$('fields').addEventListener('change', event => {
  const input = event.target as HTMLInputElement, f = shown.find(f => f.path === input.dataset.path);
  if (f) void edit(setOps(f, input.value, shown));
});
$('fields').addEventListener('click', event => {
  const f = shown.find(f => f.path === (event.target as HTMLElement).dataset.reset);
  if (f) void edit(setOps(f, '', shown));
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

// A palette entry (spec 0015 §3.1) goes inside the selected shape when it receives shapes (it holds some, or is a zone), otherwise at the top
// level, in one edit under a key the editor picks; then its name is ready to type.
async function insert(make: () => Entry | undefined) {
  // Keys and the board's classes must come from the text as it is now: a stale class list would write Zone's defaults over a `zone` class just
  // typed. So wait for the current text's compile, and refuse while it does not compile.
  await compiled();
  if (state.painted !== state.revision) { status('The D2 text must compile before adding to it.', true); return; }
  const board = state.result?.boards?.find(b => b.path === state.board), entry = make(), parent = objectOf(state.selected);
  if (!board || !entry) return;
  const at = parent && receives(parent, { board: board.association, engine: layout() }) ? parent.id : '';
  const ops = entry.ops({ board: board.association, parent: at }), key = ops.find(o => o.op === 'create')!.key;
  const result = await edit(ops);
  if (!result) return;
  state.selected = result.ids.created[0] ?? key;
  await compiled();
  const input = $('rename').querySelector('input') as HTMLInputElement;
  input.focus();
  input.select();
}
const entryOf = (id: string) => entries(state.result?.boards?.find(b => b.path === state.board)?.association.classes ?? []).find(e => e.id === id);
$('add').addEventListener('click', () => void insert(() => entryOf('shape')));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-entry]')) button.addEventListener('click', () => void insert(() => entryOf(button.dataset.entry!)));
// One button per class the board defines, except `zone`, which has its own (spec 0015 §3.1).
let shownClasses = '';
function classButtons(classes: readonly string[]) {
  const named = classes.filter(c => c !== 'zone');
  if (named.join('\n') === shownClasses) return;
  shownClasses = named.join('\n');
  $('classes').hidden = !named.length;
  $('classes').replaceChildren(...named.map(c => {
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: c, title: `Add a shape with class ${c}` });
    button.dataset.class = c;
    button.addEventListener('click', () => void insert(() => entryOf(`class:${c}`)));
    return button;
  }));
}

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
  if (event.key === 'Escape') { connectAbort?.(); connecting(false); select(''); return; }
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

$<HTMLSelectElement>('board').addEventListener('change', event => { state.board = (event.target as HTMLSelectElement).value; state.selected = ''; notice = ''; fitNext = true; connecting(false); pending = undefined; status('Compiling…'); void compile([1]); });

function openText(text: string) {
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
  // Textarea values normalise CRLF; retain the document's line endings until the user types or accepts an edit.
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
  window.history.replaceState(null, '', location.pathname + location.hash);
}

src.value = initial;
setText(initial, { record: false });
if (shared !== undefined && shared !== initial) setText(shared);
if (sharedError) status(notice = sharedError, true);

$('share').addEventListener('click', async () => {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('script', await encodeScript(state.text));
  url.searchParams.set('layout', layoutSelect.value);
  if (themeSelect.value !== 'auto') url.searchParams.set('theme', themeSelect.value);
  if (sketchBox.checked) url.searchParams.set('sketch', '1');
  try { await navigator.clipboard.writeText(url.href); status(`Link copied (${url.href.length} characters)`); }
  catch { status(`Copy this link: ${url.href}`); }
});
