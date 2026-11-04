// Renders the generated controls of one inspector section (spec 0018 §3.2): a control per widget, Reset when the value is declared.
import type { Field } from './capabilities.ts';

const DEFAULT = "D2's default";

function control(f: Field, widget: string): HTMLInputElement | HTMLSelectElement {
  const { domain } = f;
  if (domain.kind === 'boolean' && widget === 'toggle') return Object.assign(document.createElement('input'), { type: 'checkbox' });
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

function build(f: Field, widget: string) {
  const label = document.createElement('label'), el = control(f, widget);
  el.dataset.path = f.path;
  const reset = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Reset', title: `Remove ${f.keyword}; D2's default applies` });
  reset.dataset.reset = f.path;
  const row = Object.assign(document.createElement('span'), { className: widget === 'toggle' ? 'toggle' : 'color' });
  row.append(el, ...(widget === 'toggle' ? [] : [reset]));
  label.append(Object.assign(document.createElement('span'), { textContent: f.keyword }), row);
  if (widget === 'toggle') label.append(reset);
  if (f.note) label.append(Object.assign(document.createElement('small'), { textContent: f.note }));
  return label;
}

// Rebuilds only when the set of fields changes, so a focused control keeps its place across compiles.
export function renderFields(host: HTMLElement, fields: Field[], widgets: Record<string, string> = {}) {
  const signature = fields.map(f => `${f.path}${widgets[f.path] ?? ''}${f.note ?? ''}`).join('|');
  if (host.dataset.signature !== signature) {
    host.dataset.signature = signature;
    host.replaceChildren(...fields.map(f => build(f, widgets[f.path] ?? '')));
  }
  for (const f of fields) {
    const el = host.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-path="${CSS.escape(f.path)}"]`);
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = f.value === 'true';
    else if (el && el !== document.activeElement) el.value = f.value ?? '';
    host.querySelector<HTMLElement>(`[data-reset="${CSS.escape(f.path)}"]`)!.hidden = f.value === undefined || Boolean(f.note);
  }
}
