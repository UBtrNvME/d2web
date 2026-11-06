import { EditorState, StateEffect, StateField, type Transaction } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { codeFolding, foldedRanges, foldGutter, foldKeymap, foldService, unfoldEffect } from '@codemirror/language';
import type { Association } from '../../d2web/src/index.ts';

type Range = { from: number; to: number };
export const replaceFolds = StateEffect.define<Range[]>();

export function bodyRanges(association: Association | undefined, entry: string, text: string): Range[] {
  const ranges = new Map<string, Range>(), shown = text.replace(/\r\n?/g, '\n');
  for (const object of association?.objects ?? []) for (const body of object.bodies ?? []) {
    const start = body.start.offset, end = body.end.offset;
    if (body.path !== entry || start < 0 || end > text.length || text[start] !== '{' || text[end - 1] !== '}') continue;
    const from = text.slice(0, start + 1).replace(/\r\n?/g, '\n').length, to = text.slice(0, end - 1).replace(/\r\n?/g, '\n').length;
    if (to > from && shown.slice(from, to).includes('\n')) ranges.set(`${from}:${to}`, { from, to });
  }
  return [...ranges.values()].sort((a, b) => a.from - b.from || b.to - a.to);
}

function touched(tr: Transaction, range: Range) {
  const start = tr.startState.doc.lineAt(range.from).from, end = tr.startState.doc.lineAt(range.to).to;
  let hit = false;
  tr.changes.iterChangedRanges((from, to) => { if (from <= end && to >= start) hit = true; });
  return hit;
}

export const foldField = StateField.define<Range[]>({
  create: () => [],
  update(ranges, tr) {
    if (tr.docChanged) ranges = ranges.filter(r => !touched(tr, r)).map(r => ({ from: tr.changes.mapPos(r.from), to: tr.changes.mapPos(r.to) }));
    for (const effect of tr.effects) if (effect.is(replaceFolds)) ranges = effect.value;
    return ranges;
  },
});

export function diagnosticUnfolds(state: EditorState, diagnostics: readonly Range[]) {
  const effects: StateEffect<Range>[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    if (diagnostics.some(d => d.from <= to && d.to >= from)) effects.push(unfoldEffect.of({ from, to }));
  });
  return effects;
}

export const sourceFolds = [
  foldField, codeFolding({ placeholderText: '…' }), foldGutter({ foldingChanged: update => update.startState.field(foldField) !== update.state.field(foldField) }), keymap.of(foldKeymap),
  foldService.of((state, start, end) => state.field(foldField).find(r => r.from >= start && r.from <= end) ?? null),
  EditorState.transactionExtender.of(tr => {
    let replacement: Range[] | undefined;
    for (const effect of tr.effects) if (effect.is(replaceFolds)) replacement = effect.value;
    if (!tr.docChanged && !replacement) return null;
    const effects: StateEffect<Range>[] = [];
    // CodeMirror maps folds through edits; touching any of their lines makes our compile-owned range stale.
    foldedRanges(tr.startState).between(0, tr.startState.doc.length, (from, to) => {
      if (tr.docChanged && touched(tr, { from, to }) || replacement && !replacement.some(r => r.from === from && r.to === to)) {
        effects.push(unfoldEffect.of({ from: tr.changes.mapPos(from, 1), to: tr.changes.mapPos(to, -1) }));
      }
    });
    return { effects };
  }),
];
