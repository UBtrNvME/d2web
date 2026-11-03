// What an element advertises (spec 0017 §3.1): its fields, with D2's value domains and sources, and the actions that work on it.
// Names, domains and shape restrictions come from keywords.json (generated from D2, ADR 0014); nothing is typed in here.
import type { Association } from '../../d2web/src/index.ts';
import table from './keywords.json' with { type: 'json' };
import { container, type Context } from './traits.ts';

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
};
export type Action = { id: string; label: string; available: boolean; reason?: string };

const keywords = table.keywords as { name: string; style?: boolean; only?: string[]; not?: string[]; domain: Domain }[];
// Style keywords D2 applies to a connection; `filled` belongs to an arrowhead, not to either.
const CONNECTION_STYLE = new Set(['opacity', 'stroke', 'stroke-width', 'stroke-dash', 'animated', 'font', 'font-size', 'font-color', 'bold', 'italic', 'underline', 'text-transform']);
const property = (name: string) => name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const list = (items: string[]) => items.join(', ');

export function capabilities(object: AssocObject, ctx: Context): { fields: Field[]; actions: Action[] } {
  const connection = object.kind === 'connection';
  const shape = object.properties.shape?.value ?? 'rectangle';
  const field = (keyword: string, path: string, domain: Domain, prop: string, extra: { available?: boolean; reason?: string } = {}): Field => {
    const held = object.properties[prop];
    return { keyword, path, domain, value: held?.value, source: held?.source, available: extra.available ?? true, reason: extra.reason };
  };
  const fields = [field('label', object.id, { kind: 'text' }, 'label')];
  if (!connection) fields.push(field('shape', `${object.id}.shape`, { kind: 'enum', values: table.shapes }, 'shape'));
  for (const k of keywords.filter(k => k.style && k.name !== 'filled' && (!connection || CONNECTION_STYLE.has(k.name)))) {
    let reason: string | undefined;
    if (!connection && k.only && !k.only.includes(shape)) reason = `D2 applies ${k.name} only to ${list(k.only)} shapes`;
    if (!connection && k.not?.includes(shape)) reason = `D2 cannot draw ${k.name} on ${shape} shapes`;
    fields.push(field(k.name, `${object.id}.style.${k.name}`, k.domain, property(k.name), { available: !reason, reason }));
  }
  const childless = container.applies(object, ctx) ? undefined
    : shape === 'image' ? 'D2 refuses children under image shapes'
    : shape === 'sql_table' || shape === 'class' ? `D2 turns the children of a ${shape} into rows`
    : 'The editor keeps content elements childless (ADR 0013)';
  const actions: Action[] = connection
    ? [{ id: 'delete', label: 'Delete', available: true }]
    : [
      { id: 'rename', label: 'Rename', available: true },
      { id: 'add-child', label: 'Add child', available: !childless, reason: childless },
      { id: 'delete', label: 'Delete', available: true },
    ];
  return { fields, actions };
}
