import type { Association, Engine } from '../../d2web/src/index.ts';

type AssocObject = Association['objects'][number];
/** `entry` is the file the editor writes; a value declared elsewhere is an import (spec 0017). */
export type Context = { board: Association; engine: Engine; entry?: string };
export type Trait = { name: string; applies(object: AssocObject, ctx: Context): boolean };

// D2 refuses image children and turns table/class children into rows; content elements stay excluded by ADR 0013.
const LEAF_SHAPES = new Set(['image', 'sql_table', 'class', 'text', 'code']);
export const container: Trait = {
  name: 'container',
  applies: o => o.kind === 'shape' && !LEAF_SHAPES.has(o.properties.shape?.value ?? '') && !['markdown', 'code', 'latex', 'sql_table', 'class'].includes(o.content ?? ''),
};
export const connectable: Trait = { name: 'connectable', applies: o => o.kind === 'shape' };
export const movable: Trait = { name: 'movable', applies: (o, ctx) => connectable.applies(o, ctx) && ctx.engine === 'tala' };
export const hasHandle: Trait = { name: 'has-handle', applies: (o, ctx) => connectable.applies(o, ctx) && Boolean(o.box) };

export function press(object: AssocObject | undefined, ctx: Context, region: 'handle' | 'body') {
  if (!object) return 'pan';
  if (region === 'handle') return hasHandle.applies(object, ctx) ? 'connect' : 'pan';
  if (movable.applies(object, ctx)) return 'move';
  // Body drags still reparent on engines that ignore positions (spec 0015 §3.3).
  return connectable.applies(object, ctx) ? 'reparent' : 'pan';
}
