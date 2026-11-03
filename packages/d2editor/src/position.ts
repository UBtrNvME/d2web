import type { Association, EditOp } from '../../d2web/src/index.ts';

type AssocObject = Association['objects'][number];
// TALA's container padding (d2talalayout layoutgraph ContainerPadding).
const CONTAINER_PADDING = 60;

/** An arrow key moves a shape this many diagram units (Shift: 1). */
export const NUDGE = 10;

const written = (o: AssocObject) => {
  const top = o.properties.top?.value, left = o.properties.left?.value;
  return top !== undefined && left !== undefined ? { top: +top, left: +left } : undefined;
};

// The `top`/`left` that put shape `id` (dx, dy) diagram units from where it is painted (spec 0014 §3), before clamping. TALA gives every fixed
// shape in one container the same origin, painted top-left minus (left, top); at the top level it is (0, 0).
function raw(objects: readonly AssocObject[], id: string, dx: number, dy: number): { top: number; left: number; origin: { x: number; y: number } } | undefined {
  const object = objects.find(o => o.id === id);
  if (object?.kind !== 'shape' || !object.box) return;
  const own = written(object);
  let x = object.box.X + dx, y = object.box.Y + dy, origin = own ? { x: object.box.X - own.left, y: object.box.Y - own.top } : { x: 0, y: 0 };
  if (own) { x = own.left + dx; y = own.top + dy; }
  else {
    const sibling = objects.find(o => o.kind === 'shape' && o.parent === object.parent && o.box && written(o));
    const parent = object.parent === undefined ? undefined : objects.find(o => o.id === object.parent);
    // shortcut: assumes the container keeps its place and TALA's rectangle padding; circles, icons, inside labels and containers TALA grows or
    // moves leave a nested drop off the drop point (spec 0014 §3). Upgrade: measure and correct, if nested accuracy matters (tried, see spec).
    origin = sibling ? { x: sibling.box!.X - written(sibling)!.left, y: sibling.box!.Y - written(sibling)!.top }
      : parent?.box ? { x: parent.box.X + CONTAINER_PADDING, y: parent.box.Y + CONTAINER_PADDING } : { x: 0, y: 0 };
    x -= origin.x;
    y -= origin.y;
  }
  return { top: Math.round(y), left: Math.round(x), origin };
}

export function place(objects: readonly AssocObject[], id: string, dx: number, dy: number): { top: number; left: number } | undefined {
  const at = raw(objects, id, dx, dy);
  return at && { top: Math.max(0, at.top), left: Math.max(0, at.left) };
}

// Spec 0016: D2 cannot write a negative `top`/`left`, but the origin is never seen, only positions relative to each other. A drop past it sits at 0
// and the container's other pinned shapes move by the overshoot (ox, oy), so the layout the author drew is kept.
// Unpinned siblings are pinned where they are painted, only on an overshoot: TALA drifts them up to 5 px when pinned ones move, and with nothing
// pinned yet the dragged shape would otherwise land off the drop point relative to them.
export function placeShifting(objects: readonly AssocObject[], id: string, dx: number, dy: number) {
  const at = raw(objects, id, dx, dy);
  if (!at) return;
  const ox = Math.max(0, -at.left), oy = Math.max(0, -at.top);
  const parent = objects.find(o => o.id === id)!.parent;
  const siblings = ox || oy ? objects.filter(o => o.id !== id && o.kind === 'shape' && o.parent === parent && o.box) : [];
  const pinned = (o: AssocObject) => written(o) ?? { top: Math.round(o.box!.Y - at.origin.y), left: Math.round(o.box!.X - at.origin.x) };
  return { top: at.top + oy, left: at.left + ox, ox, oy, siblings: siblings.map(o => ({ id: o.id, top: pinned(o).top + oy, left: pinned(o).left + ox })) };
}

// Spec 0016: leaving a container is a reparent only when the dropped shape no longer overlaps the container's box at all (user: "the shape should
// fully go out"). The pointer leaving the box, or the padding band left of the origin, is still a shift.
export const leaves = (box: { X: number; Y: number; Width: number; Height: number }, parent: { X: number; Y: number; Width: number; Height: number }, dx: number, dy: number) =>
  box.X + dx >= parent.X + parent.Width || box.X + dx + box.Width <= parent.X || box.Y + dy >= parent.Y + parent.Height || box.Y + dy + box.Height <= parent.Y;

/** The edit that writes a placement: top and left for the shape and for each sibling a past-the-origin move shifted (D2 refuses one without the other). */
export function moveOps(id: string, at: NonNullable<ReturnType<typeof placeShifting>>): EditOp[] {
  const pin = (key: string, top: number, left: number): EditOp[] => [{ op: 'set', key: `${key}.top`, value: String(top) }, { op: 'set', key: `${key}.left`, value: String(left) }];
  return [...pin(id, at.top, at.left), ...at.siblings.flatMap(s => pin(s.id, s.top, s.left))];
}
