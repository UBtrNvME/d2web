import { freeKey } from '../targets.ts';
import { leaveRows } from './shape.ts';
import type { Kind } from './types.ts';

/** `shape: sequence_diagram`: its children are actors; a drag between two actors adds a message (the connect gesture). Spans, notes and groups are derived by D2. */
export const sequence: Kind = {
  id: 'sequence',
  label: 'Sequence',
  section: { id: 'sequence', title: 'Sequence', controls: [{ keyword: 'label' }] },
  actions: [{ label: 'Add actor', ops: (o, board) => [{ op: 'create', key: freeKey(board.objects, o.id, 'actor') }] }],
  detect: o => o.kind === 'shape' && o.properties.shape?.value === 'sequence_diagram',
  read: o => ({ text: o.label }),
  write: (c, o) => [...leaveRows(o), { op: 'set', key: o.id, value: c.text }, { op: 'set', key: `${o.id}.shape`, value: 'sequence_diagram' }],
  loss: () => [],
};
