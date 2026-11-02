import { fontFamily } from './paint.js';
import { createDomView, type DomView } from './dom.ts';
import { prepareBoard, type RenderBoard } from './render.ts';
import type { Box } from './scene.ts';
export type { Box } from './scene.ts';
import type { CompileResult } from './protocol.ts';

// Spec 0002. A shadow-root host for one painted board: isolated from page CSS, D2 identity on events, optional consumer content per node.
export interface MountOptions {
  idPrefix?: string;
  a11y?: boolean;
  fonts?: 'register' | 'consumer';
  markdown?: 'positioned' | 'flow';
}
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

let counter = 0;
const owned = new WeakSet<ShadowRoot>();
const contentOwners = new WeakMap<HTMLElement, { mount: object; id: string }>();
// Font families registered in document.fonts, shared by every mount that needs them and removed with the last one.
interface FontEntry { face: FontFace; ready: Promise<FontFace>; holders: number }
const fontHolders = new Map<string, FontEntry>();

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

  let disposed = false;
  let view: DomView | undefined;
  let prepared: RenderBoard | undefined;
  const token = {};
  let board = '';
  const families = new Map<string, FontEntry>();
  const content = new Map<string, HTMLElement>();
  const listeners = new Map<D2EventType, Set<(event: D2Event) => void>>();
  const alive = () => { if (disposed) throw new MountError('mount is disposed'); };

  const rejected = new Map<string, string>();
  async function acquireFonts(fonts: CompileResult['fonts']) {
    for (const [id, data] of Object.entries(fonts ?? {})) {
      const family = fontFamily(id);
      if (disposed) return;
      if (rejected.has(id)) continue;
      let entry = families.get(family) ?? fontHolders.get(family);
      try {
        if (!entry) {
          const face = new FontFace(family, decode(data) as BufferSource);
          entry = { face, ready: face.load(), holders: 0 };
          fontHolders.set(family, entry);
        }
        if (!families.has(family)) { entry.holders++; families.set(family, entry); }
        await entry.ready;
        if (disposed) return;
        document.fonts.add(entry.face);
      } catch (error) {
        rejected.set(id, (error as Error).message);
        if (families.delete(family) && entry && --entry.holders === 0) fontHolders.delete(family);
      }
    }
  }

  function releaseFonts() {
    for (const [family, entry] of families) {
      if (--entry.holders === 0) { document.fonts.delete(entry.face); fontHolders.delete(family); }
    }
    families.clear();
  }

  const objectOf = (el: Element | null) => view?.objectOf(el);

  const emit = (type: D2EventType, id: string, domEvent: Event) => { for (const fn of listeners.get(type) ?? []) fn({ type, board, id, domEvent }); };
  const delegate = (domType: string, type: D2EventType, accept: (e: Event) => string | undefined = e => objectOf(e.target as Element)) =>
    wrapper.addEventListener(domType, e => { const id = accept(e); if (id !== undefined) emit(type, id, e); });
  delegate('click', 'click'); delegate('dblclick', 'dblclick'); delegate('contextmenu', 'contextmenu'); // focus is the object's own group taking focus (its link region has its own, native focus).
  delegate('focusin', 'focus', e => view?.focusedObject(e.target as Element));
  // hover fires when the pointer enters or leaves an object, not for movement between its parts.
  delegate('pointerover', 'hover', e => { const to = objectOf(e.target as Element); return to !== objectOf((e as PointerEvent).relatedTarget as Element | null) ? to : undefined; });
  delegate('pointerout', 'hover', e => { const from = objectOf(e.target as Element); return from !== objectOf((e as PointerEvent).relatedTarget as Element | null) ? from : undefined; });

  return {
    async update(result, path = '') {
      alive();
      let next: RenderBoard;
      try { next = prepareBoard(result, path); } catch (error) { throw new MountError((error as Error).message); }
      if (options.fonts !== 'consumer') await acquireFonts(result.fonts);
      alive();
      let rendered: DomView;
      try { rendered = createDomView(next, { idPrefix: prefix, a11y: options.a11y ?? true, markdown: options.markdown }); }
      catch (error) { throw new MountError(`cannot paint board "${path}": ${(error as Error).message}`); }
      view?.dispose();
      wrapper.replaceChildren(rendered.fragment);
      view = rendered;
      prepared = next;
      board = path;
      view.attach(shadow);
      const orphaned: string[] = [];
      for (const [id, element] of content) if (!view.setContent(id, element)) orphaned.push(id);
      const rejectedFonts = [...rejected].filter(([id]) => id in (result.fonts ?? {})).map(([id, message]) => ({ id, message }));
      return { board: path, orphaned, ...(rejectedFonts.length ? { rejectedFonts } : {}) };
    },
    nodeBox(id) { alive(); return prepared?.objects.find(o => o.id === id)?.bounds; },
    setNodeContent(id, element) {
      alive();
      const previous = content.get(id);
      if (element === previous) return;
      if (element) {
        const owner = contentOwners.get(element);
        if (owner && (owner.mount !== token || owner.id !== id)) throw new MountError('content element is already registered to another object or mount');
        const root = element.getRootNode();
        if (element.contains(host) || (root instanceof ShadowRoot && owned.has(root) && !owner)) throw new MountError('content must be consumer-owned, outside the renderer DOM');
        for (let parent = element.parentElement; parent; parent = parent.parentElement) if (contentOwners.has(parent)) throw new MountError('content cannot be nested inside registered content');
        if ([...element.querySelectorAll<HTMLElement>('*')].some(child => contentOwners.has(child))) throw new MountError('content cannot contain registered content');
      }
      view?.setContent(id, null);
      if (previous) contentOwners.delete(previous);
      if (!element) { content.delete(id); return; }
      content.set(id, element);
      contentOwners.set(element, { mount: token, id });
      view?.setContent(id, element);
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
      view?.dispose();
      wrapper.remove();
      listeners.clear();
      for (const element of content.values()) contentOwners.delete(element);
      content.clear();
      releaseFonts();
    },
  };
}
