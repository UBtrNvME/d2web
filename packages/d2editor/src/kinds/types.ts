// An element kind (ADR 0015, spec 0018): how to recognise it, and how to read and write the canonical node state that conversions pass through.
import type { AssociationObject, EditOp } from '../../../d2web/src/index.ts';

/** What every node kind can hold; a conversion is `to.write(from.read(object))`, so N kinds need N descriptors. Rows join in slice 2. */
export type Canonical = { text: string; /** A block string's tag (`md`, `latex`, a code language); absent for a plain label. */ tag?: string };
/** A titled group of controls, named by D2 keyword. Hand-built controls (label, fill, stroke, shape, icon, language) are matched by `data-keyword` in the page; the rest are generated. */
export type Section = { id: string; title: string; controls: Control[] };
/** `title` is the label shown; a toggle writes `on` (default `true`) when checked and removes the declaration when unchecked. */
export type Control = { keyword: string; title?: string; widget?: 'toggle' | 'range' | 'number'; on?: string };
export type Kind = {
  id: string;
  label: string;
  /** The kind's own section, shown after the inherited Element and Node sections. */
  section: Section;
  /** Most specific wins; the registry order is only a tie-break, so detections should not overlap. */
  detect(object: AssociationObject): boolean;
  read(object: AssociationObject): Canonical;
  write(canonical: Canonical, object: AssociationObject): EditOp[];
  /** What this kind cannot hold from the canonical state; a non-empty list asks the author first. */
  loss(canonical: Canonical, object: AssociationObject): string[];
};
