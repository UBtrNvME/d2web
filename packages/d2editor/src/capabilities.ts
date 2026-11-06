// The fields D2 honours for an element, with value domains and sources (spec 0017 §3.1). The inspector shows a curated subset of them by section (spec 0018); nothing here is typed from memory.
// Names, domains and shape restrictions come from keywords.json (generated from D2, ADR 0014); nothing is typed in here.
import type { Association } from '../../d2web/src/index.ts';
import table from './keywords.json' with { type: 'json' };
import type { EditOp } from '../../d2web/src/index.ts';
import { movable, type Context } from './traits.ts';

type AssocObject = Association['objects'][number];
export type Domain = { kind: 'enum' | 'number' | 'boolean' | 'color' | 'text'; values?: string[]; min?: number; max?: number };
type Source = AssocObject['properties'][string]['source'];
export type Field = {
  keyword: string;
  /** The edit key a `set` op writes, e.g. `x.style.opacity`. */
  path: string;
  domain: Domain;
  /** Absent when the text does not declare it: D2's default applies. */
  value?: string;
  source?: Source;
  available: boolean;
  reason?: string;
  /** Set when the value is declared in an imported file: an edit overrides it here, but Reset cannot remove it. */
  note?: string;
  /** D2 refuses one of top/left without the other, so an edit to either writes both (see setOps). */
  pair?: string;
};
const keywords = table.keywords as { name: string; style?: boolean; only?: string[]; not?: string[]; domain: Domain }[];
// Style keywords D2 applies to a connection; `filled` belongs to an arrowhead, not to either.
const CONNECTION_STYLE = new Set(['opacity', 'stroke', 'stroke-width', 'stroke-dash', 'animated', 'font', 'font-size', 'font-color', 'bold', 'italic', 'underline', 'text-transform']);
// Layout keywords the inspector advertises, per object kind; icon, constraint, class and vars have their own controls or are not fields.
const SHAPE_LAYOUT = new Set(['tooltip', 'link', 'near', 'width', 'height', 'direction', 'top', 'left', 'grid-rows', 'grid-columns', 'grid-gap', 'vertical-gap', 'horizontal-gap']);
const CONNECTION_LAYOUT = new Set(['link']); // D2's scene builder refuses a connection tooltip
export const property = (name: string) => name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const list = (items: string[]) => items.join(', ');

export function capabilities(object: AssocObject, ctx: Context): { fields: Field[]; endpoints?: { source: string; target: string } } {
  const connection = object.kind === 'connection';
  const shape = object.properties.shape?.value ?? 'rectangle';
  const field = (keyword: string, path: string, domain: Domain, prop: string, extra: { available?: boolean; reason?: string } = {}): Field => {
    const held = object.properties[prop];
    const imported = ctx.entry && held?.source && held.source.path !== ctx.entry ? held.source.path : undefined;
    return {
      keyword, path, domain, value: held?.value, source: held?.source, available: extra.available ?? true, reason: extra.reason,
      note: imported && `Declared in ${imported}: an edit overrides it here; Reset cannot remove it`,
    };
  };
  const fields = [field('label', object.id, { kind: 'text' }, 'label')];
  if (!connection) fields.push(field('shape', `${object.id}.shape`, { kind: 'enum', values: table.shapes }, 'shape'));
  for (const k of keywords.filter(k => k.style && k.name !== 'filled' && (!connection || CONNECTION_STYLE.has(k.name)))) {
    let reason: string | undefined;
    if (!connection && k.only && !k.only.includes(shape)) reason = `D2 applies ${k.name} only to ${list(k.only)} shapes`;
    if (!connection && k.not?.includes(shape)) reason = `D2 cannot draw ${k.name} on ${shape} shapes`;
    fields.push(field(k.name, `${object.id}.style.${k.name}`, k.domain, property(k.name), { available: !reason, reason }));
  }
  for (const k of keywords.filter(k => !k.style && (connection ? CONNECTION_LAYOUT : SHAPE_LAYOUT).has(k.name))) {
    let reason: string | undefined;
    if (k.name === 'near' && object.parent) reason = 'D2 allows constant near keys only on root level shapes';
    if ((k.name === 'top' || k.name === 'left') && !movable.applies(object, ctx)) reason = 'Only the TALA layout engine honours top and left';
    const f = field(k.name, `${object.id}.${k.name}`, k.domain, k.name, { available: !reason, reason });
    if (k.name === 'top') f.pair = `${object.id}.left`;
    if (k.name === 'left') f.pair = `${object.id}.top`;
    fields.push(f);
  }
  if (connection) {
    for (const side of ['source', 'target']) {
      fields.push(field(`${side}-arrowhead`, `${object.id}.${side}-arrowhead.shape`, { kind: 'enum', values: table.arrowheads }, `${side}-arrowhead`));
      fields.push(field(`${side}-arrowhead.filled`, `${object.id}.${side}-arrowhead.style.filled`, keywords.find(k => k.name === 'filled')!.domain, `${side}-arrowhead.filled`));
    }
  }
  return { fields, endpoints: connection && object.src && object.dst ? { source: object.src, target: object.dst } : undefined };
}

/** The edit ops for setting a field (a blank value deletes the declaration); top and left always travel together. */
export function setOps(f: Field, value: string, fields: Field[]): EditOp[] {
  const v = value.trim(), op = (key: string): EditOp => (v ? { op: 'set', key, value: v } : { op: 'delete', key });
  const ops = [op(f.path)];
  if (f.pair) {
    const other = fields.find(o => o.path === f.pair);
    // Setting adds the companion at 0 only when the text does not declare it; clearing removes both.
    if (!v) ops.push({ op: 'delete', key: f.pair });
    else if (other && other.value === undefined) ops.push({ op: 'set', key: f.pair, value: '0' });
  }
  return ops;
}
