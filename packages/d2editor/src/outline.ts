import type { Association } from '../../d2web/src/index.ts';

export type OutlineRow = { id: string; kind: 'shape' | 'connection'; label: string; offset?: number; children: OutlineRow[] };

export function buildOutline(association: Association): OutlineRow[] {
  const rows = new Map<string, OutlineRow>(), roots: OutlineRow[] = [];
  for (const object of association.objects) rows.set(object.id, {
    id: object.id, kind: object.kind, label: object.kind === 'connection' ? `${object.src} -> ${object.dst}` : object.label || object.id,
    offset: object.references[0]?.start.offset, children: [],
  });
  for (const object of association.objects) {
    if (object.kind !== 'shape') continue;
    const parent = object.parent && rows.get(object.parent);
    (parent ? parent.children : roots).push(rows.get(object.id)!);
  }
  for (const object of association.objects) if (object.kind === 'connection') roots.push(rows.get(object.id)!);
  return roots;
}
