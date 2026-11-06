import type { Association } from '../../d2web/src/index.ts';
import { container, connectable, type Context } from './traits.ts';

type AssocObject = Association['objects'][number];
type Box = NonNullable<AssocObject['box']>;

// Where a dragged or connected shape lands (spec 0015 §3.3, §3.4). Used only by visual editing, which is behind the `?visual=1` flag.
const within = (id: string, ancestor: string) => id === ancestor || id.startsWith(`${ancestor}.`);

// D2's reserved keywords (d2ast.ReservedKeywords at v0.9.0, with `classes`, `source-arrowhead` and `target-arrowhead`): never a shape name.
const RESERVED = new Set(['3d', 'animated', 'bold', 'border-radius', 'class', 'classes', 'constraint', 'direction', 'double-border', 'fill', 'fill-pattern', 'filled',
  'font', 'font-color', 'font-size', 'grid-columns', 'grid-gap', 'grid-rows', 'height', 'horizontal-gap', 'icon', 'italic', 'label', 'layers', 'left', 'link',
  'multiple', 'near', 'opacity', 'scenarios', 'shadow', 'shape', 'source-arrowhead', 'steps', 'stroke', 'stroke-dash', 'stroke-width', 'target-arrowhead',
  'text-transform', 'tooltip', 'top', 'underline', 'vars', 'vertical-gap', 'width']);

// The first of `base`, `base 2`, `base 3`… (D2's own scheme) not already an ID under `parent`; D2 IDs ignore case, and a keyword starts at 2.
export function freeKey(objects: readonly AssocObject[], parent: string, base: string) {
  const taken = new Set(objects.map(o => o.id.toLowerCase()));
  const prefix = parent ? `${parent}.` : '';
  for (let n = RESERVED.has(base.toLowerCase()) ? 2 : 1; ; n++) {
    const key = `${prefix}${n === 1 ? base : `${base} ${n}`}`;
    if (!taken.has(key.toLowerCase())) return key;
  }
}

const contains = (b: Box, x: number, y: number) => x >= b.X && x <= b.X + b.Width && y >= b.Y && y <= b.Y + b.Height;
const depth = (o: AssocObject) => o.id.split('.').length;

// A Container that receives drops: one that already holds shapes, or a zone. A plain leaf rectangle is a Container in D2 but not a target, or
// repositioning a shape next to a sibling on TALA would nest it.
export const receives = (o: AssocObject, ctx: Context) => container.applies(o, ctx) && (o.classes?.includes('zone') || ctx.board.objects.some(c => c.parent === o.id));

// Spec 0015 §3.3: the deepest receiving Container whose box holds (x, y), never `dragged` or its descendants; '' is the board's root.
export function dropTarget(ctx: Context, x: number, y: number, dragged = '') {
  const hits = ctx.board.objects.filter(o => o.box && receives(o, ctx) && !(dragged && within(o.id, dragged)) && contains(o.box, x, y));
  return hits.sort((a, b) => depth(b) - depth(a))[0]?.id ?? '';
}

// Spec 0015 §3.4: the deepest shape whose box holds (x, y), else the nearest within `slop` (diagram units) of its box. A receiving Container is
// not a target: a release in its empty area creates a shape inside it (dropTarget).
export function connectTarget(ctx: Context, x: number, y: number, slop: number) {
  const shapes = ctx.board.objects.filter(o => connectable.applies(o, ctx) && o.box && !receives(o, ctx));
  const inside = shapes.filter(o => contains(o.box!, x, y)).sort((a, b) => depth(b) - depth(a))[0];
  if (inside) return inside.id;
  const gap = (b: Box) => Math.hypot(Math.max(b.X - x, 0, x - b.X - b.Width), Math.max(b.Y - y, 0, y - b.Y - b.Height));
  const near = shapes.map(o => ({ id: o.id, d: gap(o.box!) })).filter(c => c.d <= slop).sort((a, b) => a.d - b.d)[0];
  return near?.id ?? '';
}
