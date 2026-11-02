import { paintScene } from './paint.js';
import type { RenderBoard } from './render.ts';

export interface DomOptions { idPrefix: string; a11y: boolean; markdown?: 'positioned' | 'flow' }
export interface DomView {
  fragment: DocumentFragment;
  attach(shadow: ShadowRoot): void;
  objectOf(element: Element | null): string | undefined;
  focusedObject(element: Element): string | undefined;
  setContent(id: string, element: HTMLElement | null): boolean;
  dispose(): void;
}

// Only the native DOM renderer knows painter markup, baseline probes, animation targets and content frames.
export function createDomView(board: RenderBoard, options: DomOptions): DomView {
  const { html, animations } = paintScene(board.scene, { html: true, cssMasks: 'subtree', idPrefix: options.idPrefix, a11y: options.a11y, association: board.association.objects, flow: options.markdown === 'flow' });
  const template = document.createElement('template');
  template.innerHTML = html;
  const fragment = template.content;
  const nodes = new Map([...fragment.querySelectorAll<HTMLElement>('[data-id]')].map(el => [el.dataset.id!, el]));
  const frames = new Map(board.objects.flatMap(o => { const el = nodes.get(o.id); return el ? [[o.id, el] as const] : []; }));
  const owners = new WeakMap<Element, string>();
  for (const [id, el] of frames) owners.set(el, id);
  for (const a of fragment.querySelectorAll<HTMLElement>('a[data-k=link]')) {
    const [x, y, w, h] = [a.style.left, a.style.top, a.style.width, a.style.height].map(parseFloat);
    const link = board.links.find(l => Math.abs(l.region.Box.X - x) < .0001 && Math.abs(l.region.Box.Y - y) < .0001 && Math.abs(l.region.Box.Width - w) < .0001 && Math.abs(l.region.Box.Height - h) < .0001);
    if (link?.objectId) owners.set(a, link.objectId);
  }
  const targets = animations.flatMap((list, i) => {
    const el = fragment.querySelector(`[data-d2-anim="${i}"]`);
    return list.map(spec => {
      const target = spec.target === 'primitive' ? el?.firstElementChild : el;
      if (!target) throw new Error(`animation ${i} has no DOM target`);
      return { target, spec };
    });
  });
  const text = [...fragment.querySelectorAll<HTMLElement>('[data-k=text]')];
  const flow = [...fragment.querySelectorAll<HTMLElement>('[data-flow-markdown]')];
  const originals = new Map<string, { fragment: DocumentFragment; element: HTMLElement }>();
  const running: Animation[] = [];

  let shadow: ShadowRoot;
  const codeBlocks = new Set(fragment.querySelectorAll('pre'));
  const tooltips = [...fragment.querySelectorAll<HTMLElement>('[role=tooltip]')];
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
    if (!pre || !codeBlocks.has(pre)) return;
    const textOf = (node: Node): string => (node.nodeType === Node.TEXT_NODE ? node.textContent ?? '' : [...node.childNodes].map(textOf).join(''));
    e.clipboardData?.setData('text/plain', textOf(range.cloneContents()));
    e.preventDefault();
  };

  // A focus tooltip is dismissed with Escape and stays dismissed until focus moves (WCAG 1.4.13).
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') for (const t of tooltips) if (t.offsetParent) t.dataset.dismissed = ''; };
  const onFocusOut = () => { for (const t of tooltips.filter(t => t.hasAttribute('data-dismissed'))) delete t.dataset.dismissed; };


  function calibrate() {
    // Local points recover the baseline through ancestor/scene scale without rounded layout metrics.
    const probes = text.map(el => [0, 100].map(top => {
      const p = document.createElement('span');
      p.style.cssText = `position:absolute;left:0;top:${top}px;width:0;height:0`;
      el.append(p);
      return p;
    }));
    const offsets = text.map((el, k) => {
      const [a, b] = probes[k].map(p => p.getBoundingClientRect());
      const marker = el.querySelector('[data-baseline]')!.getBoundingClientRect();
      const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
      return length ? 100 * ((marker.x - a.x) * dx + (marker.y - a.y) * dy) / length : 0;
    });
    probes.flat().forEach(p => p.remove());
    text.forEach((el, k) => { el.style.top = `${Number(el.dataset.y) - offsets[k]}px`; });
  }

  return {
    fragment,
    attach(root) {
      shadow = root;
      // WebKit retargets shadow-root copy events to the host.
      shadow.host.addEventListener('copy', onCopy as EventListener);
      shadow.host.addEventListener('keydown', onKey as EventListener);
      shadow.host.addEventListener('focusout', onFocusOut);
      for (const { target, spec } of targets) running.push(target.animate(spec.keyframes as Keyframe[], spec.options));
      calibrate();
      for (const el of flow) {
        const d2 = JSON.parse(el.dataset.flowD2!);
        const width = Math.max(el.offsetWidth, el.scrollWidth), height = Math.max(el.offsetHeight, el.scrollHeight);
        el.dataset.flowFit = JSON.stringify({ d2, width, height, deltaWidth: width - d2.width, deltaHeight: height - d2.height });
      }
    },
    objectOf(element) {
      for (let el = element; el; el = el.parentElement) {
        const id = owners.get(el);
        if (id !== undefined) return id;
      }
      return undefined;
    },
    focusedObject(element) { const id = owners.get(element); return id !== undefined && frames.get(id) === element ? id : undefined; },
    setContent(id, element) {
      const frame = frames.get(id), box = board.objects.find(o => o.id === id)?.bounds;
      if (!frame || !box) return false;
      const previous = originals.get(id);
      if (previous) { previous.element.remove(); frame.replaceChildren(previous.fragment); originals.delete(id); }
      if (!element) return true;
      const saved = document.createDocumentFragment();
      saved.append(...frame.childNodes);
      const holder = document.createElement('div');
      holder.dataset.d2Content = id;
      holder.style.cssText = `position:absolute;box-sizing:border-box;left:${box.X}px;top:${box.Y}px;width:${box.Width}px;height:${box.Height}px`;
      holder.append(element);
      frame.append(holder);
      originals.set(id, { fragment: saved, element });
      return true;
    },
    dispose() {
      shadow?.host.removeEventListener('copy', onCopy as EventListener);
      shadow?.host.removeEventListener('keydown', onKey as EventListener);
      shadow?.host.removeEventListener('focusout', onFocusOut);
      for (const a of running) a.cancel();
      for (const entry of originals.values()) entry.element.remove();
      originals.clear();
    },
  };
}
