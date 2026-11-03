import type { Association } from '../../d2web/src/index.ts';

type AssocObject = Association['objects'][number];
// TALA's container padding for a plain rectangle (d2talalayout layoutgraph ContainerPadding); circles, icons and inside labels change it.
const CONTAINER_PADDING = 60;

const written = (o: AssocObject) => {
  const top = o.properties.top?.value, left = o.properties.left?.value;
  return top !== undefined && left !== undefined ? { top: +top, left: +left } : undefined;
};

// The `top`/`left` that put shape `id` (dx, dy) diagram units from where it is painted (spec 0014 §3). TALA gives every fixed shape in one
// container the same origin, painted top-left minus (left, top); at the top level it is (0, 0). Inside a container the origin moves when the
// container does (TALA grows a circle around a fixed child), so only top-level results are `exact`; the editor measures and corrects the rest.
export function place(objects: readonly AssocObject[], id: string, dx: number, dy: number): { top: number; left: number; exact: boolean } | undefined {
  const object = objects.find(o => o.id === id);
  if (object?.kind !== 'shape' || !object.box) return;
  const own = written(object);
  let x = object.box.X + dx, y = object.box.Y + dy;
  const sibling = own ? undefined : objects.find(o => o.kind === 'shape' && o.parent === object.parent && o.box && written(o));
  if (own) { x = own.left + dx; y = own.top + dy; }
  else {
    const parent = object.parent === undefined ? undefined : objects.find(o => o.id === object.parent);
    const origin = sibling ? { x: sibling.box!.X - written(sibling)!.left, y: sibling.box!.Y - written(sibling)!.top }
      : parent?.box ? { x: parent.box.X + CONTAINER_PADDING, y: parent.box.Y + CONTAINER_PADDING } : { x: 0, y: 0 };
    x -= origin.x;
    y -= origin.y;
  }
  return { top: Math.max(0, Math.round(y)), left: Math.max(0, Math.round(x)), exact: object.parent === undefined };
}

// One correction of a nested shape's top or left toward `target` (spec 0014 §3): written units per painted pixel as measured from the previous
// attempt (a secant step), else 1. A slope outside 0.2..5 means the layout jumped rather than slid, so the step falls back to the miss.
export function step(written: number, painted: number, target: number, prev?: { written: number; painted: number }): number {
  const slope = prev && painted !== prev.painted ? (written - prev.written) / (painted - prev.painted) : 1;
  return Math.max(0, Math.round(written + (target - painted) * (slope > 0.2 && slope < 5 ? slope : 1)));
}

// A nested drop still being measured: the drop point relative to the container's painted corner, tries left, the best attempt so far, and the
// previous attempt (for the secant slopes).
export type Aim = { X: number; Y: number; tries: number; best?: { top: number; left: number; miss: number }; prev?: { top: number; left: number; X: number; Y: number } };

// The next top/left toward `aim`, given where TALA painted them, or undefined when done: both axes step with the slope measured from the previous
// attempt (`step`). Moving a child can grow or shift its container, so an attempt can get worse; when out of tries or stuck it settles on the best
// attempt seen, so the result is never worse than the best try.
export function attempt(at: { top: number; left: number }, painted: { X: number; Y: number }, aim: Aim): { top: number; left: number; aim: Aim } | undefined {
  const worst = Math.max(Math.abs(aim.X - painted.X), Math.abs(aim.Y - painted.Y));
  if (worst <= 1) return;
  const best = !aim.best || worst < aim.best.miss ? { ...at, miss: worst } : aim.best;
  const settle = () => (best.top === at.top && best.left === at.left ? undefined : { top: best.top, left: best.left, aim: { X: aim.X, Y: aim.Y, tries: 0, best } });
  if (aim.tries <= 1) return settle();
  const left = step(at.left, painted.X, aim.X, aim.prev && { written: aim.prev.left, painted: aim.prev.X });
  const top = step(at.top, painted.Y, aim.Y, aim.prev && { written: aim.prev.top, painted: aim.prev.Y });
  if (left === at.left && top === at.top) return settle();
  return { top, left, aim: { X: aim.X, Y: aim.Y, tries: aim.tries - 1, best, prev: { ...at, ...painted } } };
}
