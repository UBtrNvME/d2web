import type { Association } from '../../d2web/src/index.ts';
import type { Domain } from './capabilities.ts';

export type LiteralKind = NonNullable<Association['objects'][number]['properties'][string]['literal']>['kind'];

/** A native control replaces only the scalar D2 identified; invalid partial input leaves it alone. */
export function writeLiteral(original: string, kind: LiteralKind, domain: Domain, value: string | number | boolean): string {
  if (domain.kind === 'color') {
    let hex = String(value).toLowerCase();
    if (/^#[\da-f]{3}$/.test(hex)) hex = '#' + [...hex.slice(1)].map(c => c + c).join('');
    if (!/^#[\da-f]{6}$/.test(hex)) return original;
    const held = original.replace(/^['"]|['"]$/g, '');
    const alpha = /^#[\da-f]{8}$/i.test(held) ? held.slice(7) : /^#[\da-f]{4}$/i.test(held) ? held[4].repeat(2) : '';
    const quote = kind === 'single-quoted' ? "'" : '"';
    return quote + hex + alpha + quote;
  }
  if (domain.kind === 'number') {
    if (String(value).trim() === '' || !Number.isFinite(Number(value))) return original;
    return String(Math.min(domain.max ?? Infinity, Math.max(domain.min ?? -Infinity, Number(value))));
  }
  if (domain.kind === 'boolean') return value === true || value === 'true' ? 'true' : 'false';
  if (domain.kind === 'enum' && domain.values?.includes(String(value))) return String(value);
  return original;
}

/** The narrow replacement also lets CodeMirror map untouched decorations through undo and canvas edits. */
export function textChange(before: string, after: string) {
  let from = 0, to = before.length, end = after.length;
  while (from < to && from < end && before[from] === after[from]) from++;
  while (to > from && end > from && before[to - 1] === after[end - 1]) { to--; end--; }
  return { from, to, insert: after.slice(from, end) };
}

/** Translate a CodeMirror position back into the author's source, whose line endings can be CRLF. */
export function rawOffset(text: string, offset: number) {
  let raw = 0;
  for (let shown = 0; shown < offset && raw < text.length; shown++, raw++) if (text[raw] === '\r' && text[raw + 1] === '\n') raw++;
  return raw;
}
