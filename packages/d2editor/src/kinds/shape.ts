import type { Kind } from './types.ts';

// Kinds with their own surface in a later slice, or no kind yet: not a plain shape, so they fall to the "edit in source" fallback.
const OTHER = new Set(['sql_table', 'class', 'image', 'sequence_diagram', 'hierarchy']);

/** A node whose content is its label: any drawn shape without a block string or structure. */
export const shape: Kind = {
  id: 'shape',
  label: 'Shape',
  detect: o => o.kind === 'shape' && !o.content && !OTHER.has(o.properties.shape?.value ?? ''),
  read: o => ({ text: o.label }),
  // No tag removes the block form and leaves the style, children and `shape:` line as they are (TestKindWrites).
  write: (c, o) => [{ op: 'set', key: o.id, value: c.text }],
  loss: () => [],
};
