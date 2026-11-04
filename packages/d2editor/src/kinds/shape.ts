import type { AssociationObject, EditOp } from '../../../d2web/src/index.ts';
import type { Kind } from './types.ts';

// Kinds with their own surface in a later slice, or no kind yet: not a plain shape, so they fall to the "edit in source" fallback.
const OTHER = new Set(['sql_table', 'class', 'image', 'sequence_diagram', 'hierarchy']);

/** D2 cannot remove a `shape:` line through the edit API (TestKindDeleteLimits), so leaving a kind that owns one writes an explicit rectangle. */
export const resetShape = (o: AssociationObject): EditOp[] => (OTHER.has(o.properties.shape?.value ?? '') ? [{ op: 'set', key: `${o.id}.shape`, value: 'rectangle' }] : []);

/** A node whose content is its label: any drawn shape without a block string or structure. */
export const shape: Kind = {
  id: 'shape',
  label: 'Shape',
  section: { id: 'shape', title: 'Shape', controls: [{ keyword: 'label' }, { keyword: 'shape' }, { keyword: 'icon' }, { keyword: '3d', title: '3D', widget: 'toggle' }, { keyword: 'shadow', title: 'Shadow', widget: 'toggle' }, { keyword: 'double-border', title: 'Double border', widget: 'toggle' }, { keyword: 'multiple', title: 'Multiple', widget: 'toggle' }] },
  detect: o => o.kind === 'shape' && !o.content && !OTHER.has(o.properties.shape?.value ?? ''),
  read: o => ({ text: o.label }),
  // No tag removes the block form and leaves the style, children and `shape:` line as they are (TestKindWrites).
  write: (c, o) => [...resetShape(o), { op: 'set', key: o.id, value: c.text }],
  loss: () => [],
};
