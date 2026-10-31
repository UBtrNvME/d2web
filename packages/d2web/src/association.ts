import type { Association, AssociationObject, Source } from './protocol.ts';

// Spec 0004 section 3: pure lookups over a board's association.
export const getObject = (association: Association, id: string): AssociationObject | undefined => association.objects.find(o => o.id === id);

const before = (a: { line: number; column: number }, b: { line: number; column: number }) => a.line < b.line || (a.line === b.line && a.column < b.column);
const contains = (s: Source, at: { path: string; line: number; column: number }) => s.path === at.path && !before(at, s.start) && !before(s.end, at);
// Size of a range, with lines weighted far above columns so a one-line range is always smaller than a multi-line one.
const span = (s: Source) => (s.end.line - s.start.line) * 1e6 + (s.end.column - s.start.column);

// Objects with a reference or a property declaration containing the position (a cursor at a range's end counts), smallest range first.
// shortcut: linear scan over all objects, fine for the board sizes the corpus has; index by path when a board has tens of thousands.
export function objectsAt(association: Association, at: { path: string; line: number; column: number }): AssociationObject[] {
  return association.objects
    .map(object => {
      const sources = [...object.references, ...Object.values(object.properties).flatMap(p => (p.source ? [p.source] : []))];
      const hits = sources.filter(s => contains(s, at));
      return { object, size: hits.length ? Math.min(...hits.map(span)) : Infinity };
    })
    .filter(m => m.size !== Infinity)
    .sort((a, b) => a.size - b.size)
    .map(m => m.object);
}
