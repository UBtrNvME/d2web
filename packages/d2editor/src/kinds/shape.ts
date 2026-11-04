import type { AssociationObject, EditOp } from '../../../d2web/src/index.ts';
import { freeKey } from '../palette.ts';
import { isGrid } from '../traits.ts';
import type { Kind } from './types.ts';

// Kinds with their own surface in a later slice, or no kind yet: not a plain shape, so they fall to the "edit in source" fallback.
const OTHER = new Set(['sql_table', 'class', 'image', 'sequence_diagram', 'hierarchy']);

/** D2 cannot remove a `shape:` line through the edit API (TestKindDeleteLimits), so leaving a kind that owns one writes an explicit rectangle. */
// Rows would turn into child shapes once the shape changes, so a node that leaves a table or class deletes them first.
export const leaveRows = (o: AssociationObject): EditOp[] => (o.rows ?? []).map(r => ({ op: 'row-delete' as const, key: o.id, name: r.name }));
export const resetShape = (o: AssociationObject): EditOp[] => [...leaveRows(o), ...(OTHER.has(o.properties.shape?.value ?? '') ? [{ op: 'set' as const, key: `${o.id}.shape`, value: 'rectangle' }] : [])];
// Leaving a grid drops its grid keywords (`delete` of a reserved keyword changes nothing; `unset` removes it, spec 0019).
const resetGrid = (o: AssociationObject): EditOp[] => (['grid-rows', 'grid-columns', 'grid-gap'] as const).filter(k => o.properties[k]).map(k => ({ op: 'unset' as const, key: `${o.id}.${k}` }));
/** What a plain-shape or text target clears from the kind it leaves. */
export const resetKind = (o: AssociationObject): EditOp[] => [...resetShape(o), ...resetGrid(o)];

/** A node whose content is its label: any drawn shape without a block string or structure. */
export const shape: Kind = {
  id: 'shape',
  label: 'Shape',
  section: { id: 'shape', title: 'Shape', controls: [{ keyword: 'label' }, { keyword: 'shape' }, { keyword: 'icon' }, { keyword: '3d', title: '3D', widget: 'toggle' }, { keyword: 'shadow', title: 'Shadow', widget: 'toggle' }, { keyword: 'double-border', title: 'Double border', widget: 'toggle' }, { keyword: 'multiple', title: 'Multiple', widget: 'toggle' }] },
  // D2 turns a leaf under a sequence diagram's actor into a note.
  actions: [{
    label: 'Add note',
    when: (o, board) => board.objects.find(p => p.id === o.parent)?.properties.shape?.value === 'sequence_diagram',
    ops: (o, board) => [{ op: 'create', key: freeKey(board.objects, o.id, 'note') }],
  }],
  detect: o => o.kind === 'shape' && !o.content && !OTHER.has(o.properties.shape?.value ?? '') && !isGrid(o),
  read: o => ({ text: o.label }),
  // No tag removes the block form and leaves the style, children and `shape:` line as they are (TestKindWrites).
  write: (c, o) => [...resetKind(o), { op: 'set', key: o.id, value: c.text }],
  loss: () => [],
};
