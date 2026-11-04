import { isGrid } from '../traits.ts';
import { resetShape } from './shape.ts';
import type { Kind } from './types.ts';

/** A container whose children D2 lays out in rows and columns (`grid-rows`, `grid-columns`); their order is the layout, so cells reorder instead of moving. */
export const grid: Kind = {
  id: 'grid',
  label: 'Grid',
  section: { id: 'grid', title: 'Grid', controls: [{ keyword: 'label' }, { keyword: 'grid-columns', title: 'Columns', widget: 'number' }, { keyword: 'grid-rows', title: 'Rows', widget: 'number' }, { keyword: 'grid-gap', title: 'Gap', widget: 'number' }] },
  detect: o => o.kind === 'shape' && !o.content && isGrid(o) && !['sql_table', 'class', 'image', 'sequence_diagram', 'hierarchy'].includes(o.properties.shape?.value ?? ''),
  read: o => ({ text: o.label }),
  // A node that is not a grid yet gets two columns; D2 lays its children out.
  write: (c, o) => [...resetShape(o), { op: 'set', key: o.id, value: c.text }, ...(isGrid(o) ? [] : [{ op: 'set' as const, key: `${o.id}.grid-columns`, value: '2' }])],
  loss: () => [],
};
