// Renders the generated controls of one inspector section (spec 0018 §3.2): a control per widget, Reset when the value is declared.
import type { Field } from './capabilities.ts';
import type { Control } from './kinds/index.ts';
import type { AssociationObject, EditOp } from '../../d2web/src/index.ts';

const DEFAULT = "D2's default";

function control(f: Field, widget: string | undefined): HTMLInputElement | HTMLSelectElement {
  const { domain } = f;
  if (widget === 'toggle') return Object.assign(document.createElement('input'), { type: 'checkbox' });
  if (domain.kind === 'enum' || domain.kind === 'boolean') {
    const select = document.createElement('select');
    select.append(new Option(DEFAULT, ''), ...(domain.kind === 'boolean' ? ['true', 'false'] : domain.values ?? []).map(v => new Option(v, v)));
    return select;
  }
  const input = document.createElement('input');
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = DEFAULT;
  if (domain.kind === 'number') {
    input.type = widget === 'range' && domain.min !== undefined && domain.max !== undefined ? 'range' : 'number';
    input.step = input.type === 'range' && domain.max! <= 1 ? '0.05' : 'any';
    if (domain.min !== undefined) input.min = String(domain.min);
    if (domain.max !== undefined) input.max = String(domain.max);
  }
  return input;
}

function build(f: Field, c: Control | undefined) {
  const widget = c?.widget ?? '', label = document.createElement('label'), el = control(f, widget);
  el.dataset.path = f.path;
  el.dataset.on = c?.on ?? 'true';
  const reset = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Reset', title: `Remove ${f.keyword}; D2's default applies` });
  reset.dataset.reset = f.path;
  const row = Object.assign(document.createElement('span'), { className: widget === 'toggle' ? 'toggle' : 'color' });
  row.append(el, ...(widget === 'toggle' ? [] : [reset]));
  label.append(Object.assign(document.createElement('span'), { textContent: c?.title ?? f.keyword }), row);
  if (widget === 'toggle') label.append(reset);
  if (f.note) label.append(Object.assign(document.createElement('small'), { textContent: f.note }));
  return label;
}

// Rebuilds only when the set of fields changes, so a focused control keeps its place across compiles.
export function renderFields(host: HTMLElement, fields: Field[], controls: Record<string, Control> = {}) {
  const signature = fields.map(f => `${f.path}${JSON.stringify(controls[f.path] ?? '')}${f.note ?? ''}`).join('|');
  if (host.dataset.signature !== signature) {
    host.dataset.signature = signature;
    host.replaceChildren(...fields.map(f => build(f, controls[f.path])));
  }
  for (const f of fields) {
    const el = host.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-path="${CSS.escape(f.path)}"]`);
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = f.value !== undefined && f.value !== 'false' && f.value !== '0';
    else if (el && el !== document.activeElement) el.value = f.value ?? '';
    host.querySelector<HTMLElement>(`[data-reset="${CSS.escape(f.path)}"]`)!.hidden = f.value === undefined || Boolean(f.note);
  }
}

const CONSTRAINTS = [['PK', 'primary_key'], ['FK', 'foreign_key'], ['UNQ', 'unique']] as const;

/** The row editor of a table or class (spec 0018): edit in place, add, delete, drag to reorder. Every change is one edit through `run`. */
export function renderRows(host: HTMLElement, object: AssociationObject, flavor: 'table' | 'class', run: (ops: EditOp[]) => void) {
  const rows = object.rows ?? [], key = object.id, noun = flavor === 'table' ? 'column' : 'member';
  const signature = JSON.stringify([key, rows]);
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  const el = (tag: string, props: Record<string, unknown> = {}) => Object.assign(document.createElement(tag), props) as unknown as HTMLInputElement & HTMLButtonElement & HTMLElement;
  const free = () => {
    const base = flavor === 'table' ? 'column' : '+field', taken = new Set(rows.map(r => r.name));
    for (let n = 1; ; n++) if (!taken.has(n === 1 ? base : `${base} ${n}`)) return n === 1 ? base : `${base} ${n}`;
  };
  let dragging = '';
  const list = rows.map(row => {
    const line = el('div', { className: 'row-line', draggable: true });
    line.dataset.name = row.name;
    const name = el('input', { value: row.name, className: 'r-name', autocomplete: 'off', spellcheck: false });
    name.setAttribute('aria-label', `${noun} name`);
    name.addEventListener('change', () => { if (name.value.trim() && name.value !== row.name) run([{ op: 'row-rename', key, name: row.name, to: name.value.trim() }]); else name.value = row.name; });
    const type = el('input', { value: row.type, className: 'r-type', autocomplete: 'off', spellcheck: false });
    type.setAttribute('aria-label', `${noun} type`);
    type.addEventListener('change', () => { if (type.value !== row.type) run([{ op: 'row', key, name: row.name, type: type.value.trim() }]); });
    const chips = flavor === 'table' ? [el('span', { className: 'chips' })] : [];
    for (const [label, value] of flavor === 'table' ? CONSTRAINTS : []) {
      const on = row.constraint?.includes(value) ?? false;
      const chip = el('button', { type: 'button', textContent: label, title: value });
      chip.setAttribute('aria-pressed', String(on));
      chip.addEventListener('click', () => {
        const next = on ? (row.constraint ?? []).filter(c => c !== value) : [...(row.constraint ?? []), value];
        run([{ op: 'row', key, name: row.name, constraint: next.length ? next : null }]);
      });
      chips[0].append(chip);
    }
    const remove = el('button', { type: 'button', textContent: '×', className: 'r-del' });
    remove.setAttribute('aria-label', `Delete ${noun} ${row.name}`);
    remove.addEventListener('click', () => run([{ op: 'row-delete', key, name: row.name }]));
    line.addEventListener('dragstart', e => { dragging = row.name; e.dataTransfer?.setData('text/plain', row.name); });
    line.addEventListener('dragover', e => { if (dragging) e.preventDefault(); });
    line.addEventListener('drop', e => {
      e.preventDefault();
      const from = dragging;
      dragging = '';
      if (!from || from === row.name) return;
      const names = rows.map(r => r.name), after = names.indexOf(row.name) > names.indexOf(from);
      const before = after ? names[names.indexOf(row.name) + 1] : row.name;
      run([{ op: 'reorder', key: `${key}.${from}`, ...(before ? { before: `${key}.${before}` } : {}) }]);
    });
    line.append(el('span', { className: 'grip', textContent: '⋮⋮' }), name, type, ...chips, remove);
    line.firstElementChild!.setAttribute('aria-hidden', 'true');
    return line;
  });
  const add = el('button', { type: 'button', textContent: `+ Add ${noun}`, className: 'r-add' });
  add.addEventListener('click', () => run([{ op: 'row', key, name: free(), type: flavor === 'table' ? 'text' : 'string' }]));
  host.replaceChildren(...list, add);
}
