// The kind registry (spec 0018 §3): the one place a node kind is added. Selections resolve to a path from Element; unknown nodes fall back to Element + Node.
import type { AssociationObject } from '../../../d2web/src/index.ts';
import { shape } from './shape.ts';
import { text } from './text.ts';
import type { Kind } from './types.ts';

export type { Canonical, Kind } from './types.ts';
export const kinds: Kind[] = [shape, text];

export const kindOf = (object: AssociationObject) => kinds.find(k => k.detect(object));

/** The inheritance chain the inspector renders, root first: Element, then Node or Edge, then the node's kind when one is registered. */
export function describe(object: AssociationObject) {
  if (object.kind === 'connection') return { family: 'edge' as const, kind: undefined, path: ['element', 'edge'] };
  const kind = kindOf(object)?.id;
  return { family: 'node' as const, kind, path: kind ? ['element', 'node', kind] : ['element', 'node'] };
}

/** The edit ops that turn `object` into `to`, and what that loses (the author is asked first when it is not empty). */
export function convert(object: AssociationObject, to: Kind) {
  const from = kindOf(object);
  const canonical = (from ?? shape).read(object);
  return { ops: to.write(canonical, object), loss: to.loss(canonical, object) };
}
