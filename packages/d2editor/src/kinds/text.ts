import { resetShape } from './shape.ts';
import type { Kind } from './types.ts';

const TAG = { markdown: 'md', latex: 'latex' } as const;

/** A node whose content is a block string: markdown, code in a language, or LaTeX. Content wins over a leftover `shape:` line. */
export const text: Kind = {
  id: 'text',
  label: 'Text',
  section: { id: 'text', title: 'Text', controls: [{ keyword: 'content' }, { keyword: 'language' }] },
  detect: o => o.kind === 'shape' && (o.content === 'markdown' || o.content === 'code' || o.content === 'latex'),
  read: o => ({ text: o.label, tag: o.content === 'code' ? o.language : TAG[o.content as keyof typeof TAG] }),
  write: (c, o) => [...resetShape(o), { op: 'set', key: o.id, value: c.text, tag: c.tag ?? 'md' }],
  loss: () => [],
};
