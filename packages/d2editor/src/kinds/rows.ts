import type { Kind } from './types.ts';

const first = (text: string) => text.split('\n')[0].trim();
const shapes = (n: number) => `${n} child ${n === 1 ? 'shape' : 'shapes'}`;

/** What the table and class kinds share: D2 refuses a multi-line label on them and turns children into rows, so a conversion keeps the first line of the words
 * as the name and removes the children (both named in the loss), then writes the rows. `constraints` is a table notion. */
export function rowKind(id: 'table' | 'class', label: string, constraints: boolean): Kind {
  return {
    id,
    label,
    rows: id,
    section: { id, title: label, controls: [{ keyword: 'label' }] },
    detect: o => o.kind === 'shape' && o.content === (id === 'table' ? 'sql_table' : 'class'),
    read: o => ({ text: o.label, rows: o.rows }),
    write: (c, o) => [
      ...(c.children ?? []).map(child => ({ op: 'delete' as const, key: child })),
      // A block string label must become a plain one before the shape can change.
      ...(o.content === 'markdown' || o.content === 'code' || o.content === 'latex' || first(c.text) !== o.label ? [{ op: 'set' as const, key: o.id, value: first(c.text) }] : []),
      { op: 'set', key: `${o.id}.shape`, value: id === 'table' ? 'sql_table' : 'class' },
      ...(c.rows ?? []).map(r => ({ op: 'row' as const, key: o.id, name: r.name, type: r.type, ...(constraints && r.constraint ? { constraint: r.constraint } : {}) })),
    ],
    loss: c => [
      ...(c.children?.length ? [shapes(c.children.length)] : []),
      ...(c.text.includes('\n') ? ['the text after its first line'] : []),
      ...(!constraints && c.rows?.some(r => r.constraint?.length) ? ["the columns' constraints"] : []),
    ],
  };
}
