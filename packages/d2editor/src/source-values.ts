// Spec 0022: projections of the last good D2 association, never a second document model.
import { Annotation, StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import type { Association } from '../../d2web/src/index.ts';
import { property, type Domain } from './capabilities.ts';
import table from './keywords.json' with { type: 'json' };
import { rawOffset, writeLiteral, type LiteralKind } from './source-value.ts';

type Value = { id: string; name: string; domain: Domain; kind: LiteralKind; used: number };
type Located = { from: number; to: number; value: Value };
export const replaceValues = StateEffect.define<DecorationSet>();
export const valueEdit = Annotation.define<string>();

class Swatch extends WidgetType {
  color: string;
  constructor(color: string) { super(); this.color = color; }
  eq(other: Swatch) { return this.color === other.color; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'source-swatch';
    el.style.backgroundColor = this.color;
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
  ignoreEvent() { return false; }
}

function decorations(from: number, to: number, value: Value, text: string): Range<Decoration>[] {
  const result = [Decoration.mark({ class: 'source-value', literal: value }).range(from, to)];
  if (value.domain.kind === 'color') result.push(Decoration.widget({ widget: new Swatch(text.replace(/^['"]|['"]$/g, '')), side: -1, owner: value.id }).range(from));
  return result;
}

export const valueField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    if (tr.docChanged) {
      const touched = new Set<string>(), own: Range<Decoration>[] = [];
      for (let i = marks.iter(); i.value; i.next()) {
        const value: Value | undefined = i.value.spec.literal;
        if (!value) continue;
        let hit = false;
        tr.changes.iterChangedRanges((from, to) => { if (from <= i.to && to >= i.from) hit = true; });
        if (!hit) continue;
        touched.add(value.id);
        if (tr.annotation(valueEdit) === value.id) {
          const from = tr.changes.mapPos(i.from, -1), to = tr.changes.mapPos(i.to, 1);
          if (to > from) own.push(...decorations(from, to, value, tr.newDoc.sliceString(from, to)));
        }
      }
      marks = marks.update({ filter: (_from, _to, d) => !touched.has(d.spec.literal?.id ?? d.spec.owner) }).map(tr.changes);
      if (own.length) marks = marks.update({ add: own, sort: true });
    }
    for (const effect of tr.effects) if (effect.is(replaceValues)) marks = effect.value;
    return marks;
  },
  provide: field => EditorView.decorations.from(field),
});

export function literalDecorations(association: Association | undefined, entry: string, text: string): DecorationSet {
  const found = new Map<string, { from: number; to: number; value: Value; owners: Set<string> }>();
  for (const object of association?.objects ?? []) {
    for (const [name, held] of Object.entries(object.properties)) {
      const keyword = table.keywords.find(k => property(k.name) === name || k.name === name || (k.style && name.endsWith(`.${k.name}`)));
      if (!keyword) continue;
      const domain = keyword.domain as Domain;
      if (domain.kind === 'text' || (domain.kind === 'number' && !keyword.style)) continue;
      const literal = held.literal;
      if (!literal || held.source?.path !== entry) continue;
      const start = literal.start.offset, end = literal.end.offset, id = `${entry}:${start}:${end}`;
      if (start < 0 || end > text.length || end <= start) continue;
      const existing = found.get(id);
      if (existing) { existing.owners.add(object.id); continue; }
      const from = text.slice(0, start).replace(/\r\n?/g, '\n').length, to = text.slice(0, end).replace(/\r\n?/g, '\n').length;
      found.set(id, { from, to, value: { id, name: keyword.name, domain, kind: literal.kind, used: 1 }, owners: new Set([object.id]) });
    }
  }
  const shown = text.replace(/\r\n?/g, '\n');
  return Decoration.set([...found.values()].flatMap(({ from, to, value, owners }) => decorations(from, to, { ...value, used: owners.size }, shown.slice(from, to))), true);
}

function valueAt(view: EditorView, pos: number): Located | undefined {
  let found: Located | undefined;
  view.state.field(valueField).between(pos, pos, (from, to, mark) => {
    if (mark.spec.literal && from <= pos && pos <= to) found = { from, to, value: mark.spec.literal };
  });
  return found;
}
const stepOf = (domain: Domain) => domain.min === 0 && domain.max === 1 ? 0.05 : 1;

export function sourceValues(options: {
  text: () => string;
  setText: (text: string, options: { record: boolean; preview: boolean; valueEdit: string }) => void;
  push: (text: string) => void;
}) {
  let session: { original: string; last: string; at: Located; view: EditorView; popover: HTMLElement; events: AbortController } | undefined;
  let writing = false;
  function write(text: string, id: string, preview = true) {
    writing = true;
    try { options.setText(text, { record: false, preview, valueEdit: id }); }
    finally { writing = false; }
  }
  function close(cancel = false, focus = false, hide = true) {
    if (!session || writing) return;
    const s = session;
    session = undefined;
    s.events.abort();
    if (hide) s.popover.hidePopover();
    s.popover.remove();
    if (cancel && s.last !== s.original) write(s.original, s.at.value.id);
    else if (!cancel) options.push(s.last);
    if (focus) s.view.focus();
  }
  function open(view: EditorView, at: Located) {
    close();
    const original = options.text(), start = rawOffset(original, at.from), end = rawOffset(original, at.to);
    const raw = original.slice(start, end), value = raw.replace(/^['"]|['"]$/g, ''), domain = at.value.domain;
    const popover = document.createElement('div'), events = new AbortController();
    popover.className = 'source-value-popover';
    popover.popover = 'auto';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', at.value.name);
    popover.append(Object.assign(document.createElement('strong'), { textContent: at.value.name }));
    if (at.value.used > 1) popover.append(Object.assign(document.createElement('small'), { textContent: `Used by ${at.value.used} shapes` }));
    const controls = document.createElement('div');
    controls.className = 'value-controls';
    popover.append(controls);
    session = { original, last: original, at, view, popover, events };
    const apply = (next: string | boolean) => {
      if (!session) return;
      const replacement = writeLiteral(raw, at.value.kind, domain, next);
      const text = original.slice(0, start) + replacement + original.slice(end);
      if (text !== session.last) { session.last = text; write(text, session.at.value.id); }
    };
    const input = (type: string, label: string) => {
      const el = document.createElement('input');
      el.type = type;
      el.setAttribute('aria-label', label);
      controls.append(el);
      return el;
    };
    if (domain.kind === 'color') {
      const picker = input('color', 'Color'), hex = input('text', 'Hex color');
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.fillStyle = /^#[\da-f]{8}$/i.test(value) ? value.slice(0, 7) : /^#[\da-f]{4}$/i.test(value) ? '#' + [...value.slice(1, 4)].map(c => c + c).join('') : value;
      const resolved = String(ctx.fillStyle);
      picker.value = /^#[\da-f]{6}$/i.test(resolved) ? resolved : '#000000';
      hex.value = picker.value;
      hex.spellcheck = false;
      picker.oninput = () => { hex.value = picker.value; apply(picker.value); };
      hex.oninput = () => { if (/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex.value)) { apply(hex.value); picker.value = writeLiteral(raw, at.value.kind, domain, hex.value).slice(1, 8); } };
    } else if (domain.kind === 'boolean') {
      const checkbox = input('checkbox', at.value.name);
      checkbox.checked = value === 'true';
      checkbox.oninput = () => apply(checkbox.checked);
    } else if (domain.kind === 'enum') {
      const select = document.createElement('select');
      select.setAttribute('aria-label', at.value.name);
      select.size = Math.min(8, Math.max(2, domain.values?.length ?? 2));
      select.append(...(domain.values ?? []).map(v => new Option(v, v)));
      select.value = value;
      select.onchange = () => apply(select.value);
      controls.append(select);
    } else if (domain.kind === 'number') {
      const range = input('range', at.value.name), number = input('number', `${at.value.name} value`);
      for (const el of [range, number]) {
        if (domain.min !== undefined) el.min = String(domain.min);
        if (domain.max !== undefined) el.max = String(domain.max);
        el.step = String(stepOf(domain));
        el.value = value;
      }
      // shortcut: unbounded domains use the native slider's window; the number field retains the full D2 domain.
      if (domain.max === undefined) range.max = String(Math.max(Number(range.max) || 100, Number(value)));
      range.value = value;
      range.oninput = () => { number.value = range.value; apply(range.value); };
      number.oninput = () => {
        if (number.value === '' || !Number.isFinite(Number(number.value))) return;
        const next = writeLiteral(raw, at.value.kind, domain, number.value);
        range.value = next;
        apply(next);
      };
    }
    popover.addEventListener('beforetoggle', e => { if ((e as ToggleEvent).newState === 'closed') close(false, false, false); }, { signal: events.signal });
    popover.addEventListener('keydown', e => {
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(e.key === 'Escape', true); }
    }, { signal: events.signal });
    document.addEventListener('pointerdown', e => { if (!popover.contains(e.target as Node)) close(); }, { capture: true, signal: events.signal });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true, true); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') close(false, true);
    }, { capture: true, signal: events.signal });
    document.body.append(popover);
    popover.showPopover();
    const box = view.coordsAtPos(at.from);
    if (box) {
      popover.style.left = `${Math.max(0, Math.min(box.left, innerWidth - popover.offsetWidth))}px`;
      popover.style.top = `${Math.max(0, Math.min(box.bottom + 4, innerHeight - popover.offsetHeight))}px`;
    }
    controls.querySelector<HTMLElement>('input, select')?.focus();
    return true;
  }
  function step(view: EditorView, direction: number) {
    const at = valueAt(view, view.state.selection.main.head);
    if (!at || at.value.domain.kind !== 'number') return false;
    close();
    const original = options.text(), start = rawOffset(original, at.from), end = rawOffset(original, at.to), raw = original.slice(start, end);
    const next = Math.round((Number(raw.replace(/^['"]|['"]$/g, '')) + direction * stepOf(at.value.domain)) * 100) / 100;
    const replacement = writeLiteral(raw, at.value.kind, at.value.domain, next);
    const text = original.slice(0, start) + replacement + original.slice(end);
    if (text !== original) { write(text, at.value.id); options.push(text); }
    return true;
  }
  return {
    close: () => close(),
    refresh(view: EditorView, association: Association | undefined, entry: string, text: string) {
      view.dispatch({ effects: replaceValues.of(literalDecorations(association, entry, text)) });
      if (session) {
        const at = valueAt(view, session.at.from);
        if (at) session.at = at;
      }
    },
    extension: [valueField, keymap.of([
      { key: 'Mod-.', run: view => { const at = valueAt(view, view.state.selection.main.head); return at ? open(view, at) : false; } },
      { key: 'Alt-ArrowUp', run: view => step(view, 1) },
      { key: 'Alt-ArrowDown', run: view => step(view, -1) },
    ]), EditorView.domEventHandlers({
      click(event, view) {
        const el = (event.target as Element).closest('.source-value, .source-swatch');
        if (!el) return false;
        const at = valueAt(view, view.posAtDOM(el));
        return at ? open(view, at) : false;
      },
    }), EditorView.updateListener.of(update => { if (update.docChanged && !writing) close(); })],
  };
}
