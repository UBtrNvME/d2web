import { rowKind } from './rows.ts';

/** `shape: sql_table`: columns with a type and constraints. */
export const table = rowKind('table', 'Table', true);
