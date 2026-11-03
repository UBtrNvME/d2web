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
// last single-axis move (its slope is only trusted for that axis while the other one stayed put).
export type Aim = { X: number; Y: number; tries: number; best?: { top: number; left: number; miss: number }; moved?: { axis: 'X' | 'Y'; written: number; painted: number } };

// The next top/left toward `aim`, given where TALA painted them, or undefined when done. Moving one container child grows or shifts the container
// on both axes, so each attempt moves only the axis that misses more; when out of tries or stuck it settles on the best attempt seen.
export function attempt(at: { top: number; left: number }, painted: { X: number; Y: number }, aim: Aim): { top: number; left: number; aim: Aim } | undefined {
  const miss = { X: aim.X - painted.X, Y: aim.Y - painted.Y }, worst = Math.max(Math.abs(miss.X), Math.abs(miss.Y));
  if (worst <= 1) return;
  const best = !aim.best || worst < aim.best.miss ? { ...at, miss: worst } : aim.best;
  const settle = () => (best.top === at.top && best.left === at.left ? undefined : { top: best.top, left: best.left, aim: { X: aim.X, Y: aim.Y, tries: 0, best } });
  if (aim.tries <= 1) return settle();
  for (const axis of Math.abs(miss.X) >= Math.abs(miss.Y) ? ['X', 'Y'] as const : ['Y', 'X'] as const) {
    const key = axis === 'X' ? 'left' : 'top';
    const value = step(at[key], painted[axis], aim[axis], aim.moved?.axis === axis ? aim.moved : undefined);
    if (value !== at[key]) return { ...at, [key]: value, aim: { X: aim.X, Y: aim.Y, tries: aim.tries - 1, best, moved: { axis, written: at[key], painted: painted[axis] } } };
  }
  return settle();
}
