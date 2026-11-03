import type { Association } from '../../d2web/src/index.ts';

type AssocObject = Association['objects'][number];
// TALA's container padding (d2talalayout layoutgraph ContainerPadding).
const CONTAINER_PADDING = 60;

const written = (o: AssocObject) => {
  const top = o.properties.top?.value, left = o.properties.left?.value;
  return top !== undefined && left !== undefined ? { top: +top, left: +left } : undefined;
};

// The `top`/`left` that put shape `id` (dx, dy) diagram units from where it is painted (spec 0014 §3). TALA gives every fixed shape in one
// container the same origin, painted top-left minus (left, top); at the top level it is (0, 0).
export function place(objects: readonly AssocObject[], id: string, dx: number, dy: number): { top: number; left: number } | undefined {
  const object = objects.find(o => o.id === id);
  if (object?.kind !== 'shape' || !object.box) return;
  const own = written(object);
  let x = object.box.X + dx, y = object.box.Y + dy;
  if (own) { x = own.left + dx; y = own.top + dy; }
  else {
    const sibling = objects.find(o => o.kind === 'shape' && o.parent === object.parent && o.box && written(o));
    const parent = object.parent === undefined ? undefined : objects.find(o => o.id === object.parent);
    // shortcut: assumes the container keeps its place and TALA's rectangle padding; circles, icons, inside labels and containers TALA grows or
    // moves leave a nested drop off the drop point (spec 0014 §3). Upgrade: measure and correct, if nested accuracy matters (tried, see spec).
    const origin = sibling ? { x: sibling.box!.X - written(sibling)!.left, y: sibling.box!.Y - written(sibling)!.top }
      : parent?.box ? { x: parent.box.X + CONTAINER_PADDING, y: parent.box.Y + CONTAINER_PADDING } : { x: 0, y: 0 };
    x -= origin.x;
    y -= origin.y;
  }
  return { top: Math.max(0, Math.round(y)), left: Math.max(0, Math.round(x)) };
}
