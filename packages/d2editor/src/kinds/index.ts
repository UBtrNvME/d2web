// The kind registry (spec 0018 §3): the one place a node kind is added. Selections resolve to a path from Element; unknown nodes fall back to Element + Node.
import type { Association, AssociationObject } from '../../../d2web/src/index.ts';
import { classKind } from './class.ts';
import { grid } from './grid.ts';
import { image } from './image.ts';
import { sequence } from './sequence.ts';
import { shape } from './shape.ts';
import { table } from './table.ts';
import { text } from './text.ts';
import type { Kind, KindAction, Section } from './types.ts';

export type { Canonical, Control, Kind, KindAction, Row, Section } from './types.ts';
export const kinds: Kind[] = [shape, text, image, sequence, grid, table, classKind];

// Inherited sections: every element has these (spec 0018 §2).
const element: Section = { id: 'element', title: 'Element', controls: [{ keyword: 'stroke' }, { keyword: 'opacity', title: 'Opacity', widget: 'range' }, { keyword: 'stroke-width', title: 'Width', widget: 'number' }] };
const node: Section = { id: 'node', title: 'Node', controls: [{ keyword: 'fill' }] };
const edge: Section = { id: 'edge', title: 'Edge', controls: [{ keyword: 'label' }, { keyword: 'source-arrowhead', title: 'Start' }, { keyword: 'target-arrowhead', title: 'End' }, { keyword: 'stroke-dash', title: 'Dashed', widget: 'toggle', on: '5' }] };

/** Buttons for a section: a node kind's own, or the Edge section's Reverse. */
export const actionsOf = (sectionId: string): KindAction[] => (sectionId === 'edge'
  ? [{ label: 'Reverse', ops: o => [{ op: 'reconnect', key: o.id, reverse: true }] }]
  : kinds.find(k => k.section.id === sectionId)?.actions ?? []);

export const kindOf = (object: AssociationObject) => kinds.find(k => k.detect(object));

/** The inheritance chain the inspector renders, root first: Element, then Node or Edge, then the node's kind when one is registered. */
export function describe(object: AssociationObject) {
  if (object.kind === 'connection') return { family: 'edge' as const, kind: undefined, path: ['element', 'edge'] };
  const kind = kindOf(object)?.id;
  return { family: 'node' as const, kind, path: kind ? ['element', 'node', kind] : ['element', 'node'] };
}

/** The edit ops that turn `object` into `to`, and what that loses (the author is asked first when it is not empty). */
export function convert(object: AssociationObject, to: Kind, board?: Association) {
  const from = kindOf(object);
  const children = board?.objects.filter(o => o.parent === object.id).map(o => o.id);
  const canonical = { ...(from ?? shape).read(object), children };
  // A kind without rows drops the table's columns or the class's members.
  const rows = !to.rows && canonical.rows?.length ? [`${canonical.rows.length} ${from?.rows === 'class' ? 'members' : 'columns'}`] : [];
  return { ops: to.write(canonical, object), loss: [...rows, ...to.loss(canonical, object)] };
}

/** The sections a selection renders, root first (the inheritance chain). A node with no registered kind gets Element and Node only. */
export function sectionsOf(object: AssociationObject): Section[] {
  if (object.kind === 'connection') return [element, edge];
  const kind = kindOf(object);
  return kind ? [element, node, kind.section] : [element, node];
}
