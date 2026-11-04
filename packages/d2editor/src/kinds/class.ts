import { rowKind } from './rows.ts';

/** `shape: class`: fields and methods; a name starts with its visibility (`+`, `-`, `#`). */
export const classKind = rowKind('class', 'Class', false);
