import { fontFamily, paintScene, type AnimationSpec } from './paint.js';
import type { CompileResult } from './protocol.ts';

// Spec 0002. A shadow-root host for one painted board: isolated from page CSS, D2 identity on events, optional consumer content per node.
export interface MountOptions {
  idPrefix?: string;
  a11y?: boolean;
  fonts?: 'register' | 'consumer';
  markdown?: 'positioned' | 'flow';
}
export interface Box { X: number; Y: number; Width: number; Height: number }
// `rejectedFonts` appears only when the engine refused a font in the result (spec 0007): the board is still painted, the browser falls back for those glyphs.
export interface UpdateReport { board: string; orphaned: string[]; rejectedFonts?: { id: string; message: string }[] }
export type D2EventType = 'click' | 'dblclick' | 'contextmenu' | 'hover' | 'focus';
export interface D2Event { type: D2EventType; board: string; id: string; domEvent: Event }
export interface Mount {
  update(result: CompileResult, board?: string): Promise<UpdateReport>;
  nodeBox(id: string): Box | undefined;
  setNodeContent(id: string, element: HTMLElement | null): void;
  on(type: D2EventType, listener: (event: D2Event) => void): () => void;
  dispose(): void;
}

export class MountError extends Error {}

type Pt = { X: number; Y: number };
interface Node_ { ID?: string; Primitive?: { $: string; Box?: Box; Center?: Pt; RadiusX?: number; RadiusY?: number; Commands?: { Kind: number; P1: Pt; P2: Pt; P3: Pt }[] }; Transform?: { E: number; F: number }; Children?: Node_[] }

let counter = 0;
const owned = new WeakSet<ShadowRoot>();
// Font families registered in document.fonts, shared by every mount that needs them and removed with the last one.
const fontHolders = new Map<string, { face: FontFace; holders: number }>();

const decode = (data: string | Uint8Array) => typeof data === 'string' ? Uint8Array.from(atob(data), c => c.charCodeAt(0)) : data;

export function mount(host: HTMLElement, options: MountOptions = {}): Mount {
  if (host.shadowRoot && !owned.has(host.shadowRoot)) throw new MountError('host already has a shadow root that d2web did not create');
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (shadow.childElementCount) throw new MountError('host is already mounted');
  owned.add(shadow);
  const prefix = options.idPrefix ?? `d2w${++counter}-`;
  const wrapper = document.createElement('div');
  // visibility:inherit keeps a consumer who hides the host in control (plain all:initial would reset it).
  wrapper.style.cssText = 'all:initial;display:block;visibility:inherit';
  shadow.append(wrapper);
  // Firefox and WebKit serialise each absolutely positioned code token as its own block, so a selection inside a code block would copy one token per
  // line. Rebuild that text from the selected fragment instead: the line spans carry D2's own newlines (spec 0009).
  const onCopy = (e: ClipboardEvent) => {
    const selection = (shadow as unknown as { getSelection?: () => Selection | null }).getSelection?.() ?? document.getSelection();
    if (!selection || !selection.rangeCount) return;
    // WebKit hides a selection inside a shadow root from getRangeAt; getComposedRanges names it.
    const composed = (selection as unknown as { getComposedRanges?: (o: { shadowRoots: ShadowRoot[] }) => StaticRange[] }).getComposedRanges?.({ shadowRoots: [shadow] })[0];
    const range = composed ? document.createRange() : selection.getRangeAt(0);
    if (composed) { range.setStart(composed.startContainer, composed.startOffset); range.setEnd(composed.endContainer, composed.endOffset); }
    if (range.collapsed) return;
    const anchor = range.commonAncestorContainer;
    const pre = (anchor instanceof Element ? anchor : anchor.parentElement)?.closest('pre');
    if (!pre || !wrapper.contains(pre)) return;
    const textOf = (node: Node): string => (node.nodeType === Node.TEXT_NODE ? node.textContent ?? '' : [...node.childNodes].map(textOf).join(''));
    e.clipboardData?.setData('text/plain', textOf(range.cloneContents()));
    e.preventDefault();
  };
  // On the host, not the wrapper: WebKit retargets a copy from inside a shadow root to the host.
  host.addEventListener('copy', onCopy);

  let disposed = false;
  let running: Animation[] = [];
  let board = '';
  let scene: { Root?: Node_ } | undefined;
  const families = new Set<string>();
  const content = new Map<string, { element: HTMLElement; saved?: DocumentFragment }>();
  const listeners = new Map<D2EventType, Set<(event: D2Event) => void>>();
  const alive = () => { if (disposed) throw new MountError('mount is disposed'); };

  const rejected = new Map<string, string>();
  async function acquireFonts(fonts: CompileResult['fonts']) {
    for (const [id, data] of Object.entries(fonts ?? {})) {
      const family = fontFamily(id);
      if (families.has(family) || rejected.has(id)) continue;
      let entry = fontHolders.get(family);
      if (!entry) {
        try {
          const face = new FontFace(family, decode(data) as BufferSource);
          document.fonts.add(await face.load());
          entry = fontHolders.get(family) ?? { face, holders: 0 };
          fontHolders.set(family, entry);
        } catch (error) { rejected.set(id, (error as Error).message); continue; }
      }
      entry.holders++;
      families.add(family);
    }
  }

  function releaseFonts() {
    for (const family of families) {
      const entry = fontHolders.get(family)!;
      if (--entry.holders === 0) { document.fonts.delete(entry.face); fontHolders.delete(family); }
    }
    families.clear();
  }

  // The painter positions text by its top edge; baselines are corrected from the rendered fonts once the markup is in the document.
  function calibrate() {
    const els = [...wrapper.querySelectorAll<HTMLElement>('[data-k=text]')];
    const offsets = els.map(el => el.querySelector('[data-baseline]')!.getBoundingClientRect().top - el.getBoundingClientRect().top);
    els.forEach((el, k) => { el.style.top = `${Number(el.dataset.y) - offsets[k]}px`; });
  }

  const group = (id: string) => wrapper.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);

  function applyContent(id: string): boolean {
    const entry = content.get(id)!;
    const g = group(id);
    const box = nodeBox(id);
    if (!g || !box) return false;
    entry.saved = document.createDocumentFragment();
    entry.saved.append(...g.childNodes);
    const holder = document.createElement('div');
    holder.dataset.d2Content = id;
    holder.style.cssText = `position:absolute;box-sizing:border-box;left:${box.X}px;top:${box.Y}px;width:${box.Width}px;height:${box.Height}px`;
    holder.append(entry.element);
    g.append(holder);
    return true;
  }

  function restoreContent(id: string) {
    const entry = content.get(id);
    const g = group(id);
    if (entry?.saved && g) g.replaceChildren(entry.saved);
    if (entry) entry.saved = undefined;
  }

  // Exact for rectangles and ellipses; for path shapes (cylinder, person, ...) the bounds of the outline's points, control points included,
  // which can exceed the painted outline slightly.
  function nodeBox(id: string): Box | undefined {
    const node = scene?.Root?.Children?.find(c => c.ID === id);
    const shape = node?.Children?.find(c => c.Primitive && ['Rect', 'Ellipse', 'Path'].includes(c.Primitive.$))?.Primitive ?? node?.Primitive;
    if (!node || !shape) return undefined;
    const [dx, dy] = [node.Transform?.E ?? 0, node.Transform?.F ?? 0];
    if (shape.$ === 'Rect' && shape.Box) return { X: shape.Box.X + dx, Y: shape.Box.Y + dy, Width: shape.Box.Width, Height: shape.Box.Height };
    if (shape.$ === 'Ellipse' && shape.Center) return { X: shape.Center.X - shape.RadiusX! + dx, Y: shape.Center.Y - shape.RadiusY! + dy, Width: 2 * shape.RadiusX!, Height: 2 * shape.RadiusY! };
    if (shape.$ === 'Path' && shape.Commands) {
      const points = shape.Commands.flatMap(c => c.Kind === 5 ? [] : c.Kind === 2 ? [c.P1, c.P2] : c.Kind === 3 ? [c.P1, c.P2, c.P3] : [c.P1]);
      if (!points.length) return undefined;
      const [x0, x1] = [Math.min(...points.map(p => p.X)), Math.max(...points.map(p => p.X))];
      const [y0, y1] = [Math.min(...points.map(p => p.Y)), Math.max(...points.map(p => p.Y))];
      return { X: x0 + dx, Y: y0 + dy, Width: x1 - x0, Height: y1 - y0 };
    }
    return undefined;
  }

  // Link regions are anchors laid over the board, outside the object groups, and carry no object ID. They belong to the smallest painted
  // object whose box contains the region's centre (shape links and label links both sit inside their object).
  function objectOfLink(a: HTMLElement): string | undefined {
    const [x, y, w, h] = [a.style.left, a.style.top, a.style.width, a.style.height].map(parseFloat);
    let best: { id: string; area: number } | undefined;
    for (const child of scene?.Root?.Children ?? []) {
      const box = child.ID && !child.ID.startsWith('root:') ? nodeBox(child.ID) : undefined;
      if (box && x + w / 2 >= box.X && x + w / 2 <= box.X + box.Width && y + h / 2 >= box.Y && y + h / 2 <= box.Y + box.Height && (!best || box.Width * box.Height < best.area)) best = { id: child.ID!, area: box.Width * box.Height };
    }
    return best?.id;
  }

  // The D2 object an element belongs to: the group that is a direct child of the scene root (and not a root:* helper), or for a link region
  // the object it covers.
  function objectOf(el: Element | null): string | undefined {
    for (; el && el !== wrapper; el = el.parentElement) {
      if ((el as HTMLElement).dataset?.k === 'link') return objectOfLink(el as HTMLElement);
      const id = (el as HTMLElement).dataset?.id;
      if (id && !id.startsWith('root:') && (el.parentElement as HTMLElement | null)?.dataset?.id === 'root') return id;
    }
    return undefined;
  }

  const emit = (type: D2EventType, id: string, domEvent: Event) => { for (const fn of listeners.get(type) ?? []) fn({ type, board, id, domEvent }); };
  const delegate = (domType: string, type: D2EventType, accept: (e: Event) => string | undefined = e => objectOf(e.target as Element)) =>
    wrapper.addEventListener(domType, e => { const id = accept(e); if (id !== undefined) emit(type, id, e); });
  delegate('click', 'click'); delegate('dblclick', 'dblclick'); delegate('contextmenu', 'contextmenu'); // focus is the object's own group taking focus (its link region has its own, native focus).
  delegate('focusin', 'focus', e => { const t = e.target as HTMLElement; return t.dataset?.id && objectOf(t) === t.dataset.id ? t.dataset.id : undefined; });
  // hover fires when the pointer enters or leaves an object, not for movement between its parts.
  delegate('pointerover', 'hover', e => { const to = objectOf(e.target as Element); return to !== objectOf((e as PointerEvent).relatedTarget as Element | null) ? to : undefined; });
  delegate('pointerout', 'hover', e => { const from = objectOf(e.target as Element); return from !== objectOf((e as PointerEvent).relatedTarget as Element | null) ? from : undefined; });

  return {
    async update(result, path = '') {
      alive();
      if (result.error) throw new MountError(`result has an error: ${result.error.message}`);
      const found = result.boards?.find(b => b.path === path);
      if (!found) throw new MountError(`result has no board "${path}"`);
      if (options.fonts !== 'consumer') await acquireFonts(result.fonts);
      alive();
      let html: string, specs: AnimationSpec[][];
      try { ({ html, animations: specs } = paintScene(found.scene, { html: true, cssMasks: 'subtree', idPrefix: prefix, a11y: options.a11y ?? true, association: found.association?.objects, flow: options.markdown === 'flow' })); } catch (error) { throw new MountError(`cannot paint board "${path}": ${(error as Error).message}`); }
      // Everything that can throw has happened; from here the swap cannot fail halfway.
      const template = document.createElement('template');
      template.innerHTML = html;
      for (const a of running) a.cancel();
      wrapper.replaceChildren(template.content);
      running = [];
      // Spec 0005: each D2 track runs as a Web Animation on its element; consumers can pause it through shadowRoot.getAnimations().
      specs.forEach((list, i) => {
        const el = wrapper.querySelector(`[data-d2-anim="${i}"]`);
        for (const s of list) running.push((s.target === 'primitive' ? el?.firstElementChild : el)!.animate(s.keyframes as Keyframe[], s.options));
      });
      board = path;
      scene = found.scene as { Root?: Node_ };
      calibrate();
      for (const el of wrapper.querySelectorAll<HTMLElement>('[data-flow-markdown]')) {
        const d2 = JSON.parse(el.dataset.flowD2!);
        // offset/scroll sizes are local CSS pixels, independent of the board's viewport scale.
        const width = Math.max(el.offsetWidth, el.scrollWidth), height = Math.max(el.offsetHeight, el.scrollHeight);
        el.dataset.flowFit = JSON.stringify({ d2, width, height, deltaWidth: width - d2.width, deltaHeight: height - d2.height });
      }
      const orphaned: string[] = [];
      for (const id of content.keys()) if (!applyContent(id)) orphaned.push(id);
      const rejectedFonts = [...rejected].filter(([id]) => id in (result.fonts ?? {})).map(([id, message]) => ({ id, message }));
      return { board: path, orphaned, ...(rejectedFonts.length ? { rejectedFonts } : {}) };
    },
    nodeBox(id) { alive(); return nodeBox(id); },
    setNodeContent(id, element) {
      alive();
      restoreContent(id);
      if (!element) { content.delete(id); return; }
      content.set(id, { element });
      applyContent(id);
    },
    on(type, listener) {
      alive();
      const set = listeners.get(type) ?? new Set();
      listeners.set(type, set.add(listener));
      return () => { set.delete(listener); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const a of running) a.cancel();
      host.removeEventListener('copy', onCopy);
      wrapper.remove();
      listeners.clear();
      content.clear();
      releaseFonts();
    },
  };
}
