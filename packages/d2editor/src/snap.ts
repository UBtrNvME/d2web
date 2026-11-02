import type { Association, EditResult } from '../../d2web/src/index.ts';

// Follow oracle ID deltas, including renamed descendants and renumbered connections.
export function pairBoxes(before: Association, after: Association, renamed: EditResult['ids']['renamed'] = {}) {
  const old = new Map(before.objects.map(object => [renamed[object.id] ?? object.id, object.box]));
  return after.objects.filter(object => object.box).map(object => ({ object, before: old.get(object.id) }));
}

export function snap(root: ShadowRoot, before: Association, after: Association, ids?: EditResult['ids'], changed: string[] = []) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const elements = [...root.querySelectorAll<HTMLElement | SVGElement>('[data-id]')];
  const pulse = new Set([...changed.map(id => ids?.renamed[id] ?? id), ...(ids?.created ?? []), ...Object.values(ids?.renamed ?? {})]);
  for (const pair of pairBoxes(before, after, ids?.renamed)) {
    const { object, before: old } = pair, box = object.box!;
    const owned = elements.filter(el => object.nodes.includes(el.getAttribute('data-id')!));
    // Animate only outer owned nodes: translating nested paint nodes twice would move labels off their shapes.
    const targets = owned.filter(el => !owned.some(parent => parent !== el && parent.contains(el)));
    for (const el of targets) {
      if (!old) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
      else if (old.X !== box.X || old.Y !== box.Y || old.Width !== box.Width || old.Height !== box.Height) {
        el.animate([
          { translate: `${old.X - box.X}px ${old.Y - box.Y}px`, scale: `${box.Width ? old.Width / box.Width : 1} ${box.Height ? old.Height / box.Height : 1}`, transformOrigin: `${box.X}px ${box.Y}px` },
          { translate: '0px 0px', scale: '1 1', transformOrigin: `${box.X}px ${box.Y}px` },
        ], { duration: 240, easing: 'ease-out' });
      }
    }
    if (targets.length && pulse.has(object.id)) {
      // Ownership frames can be zero-sized; draw the outline at D2's box in the same scene coordinate parent.
      const outline = document.createElement('div');
      outline.setAttribute('aria-hidden', 'true');
      outline.style.cssText = `position:absolute;pointer-events:none;left:${box.X}px;top:${box.Y}px;width:${box.Width}px;height:${box.Height}px`;
      targets[0].parentElement!.append(outline);
      const animation = outline.animate([{ outline: '3px solid #3975d5', outlineOffset: '3px' }, { outline: '0px solid transparent', outlineOffset: '6px' }], { duration: 650 });
      void animation.finished.then(() => outline.remove(), () => outline.remove());
    }
  }
}
