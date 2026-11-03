// Renders the fields capabilities() advertises (spec 0017 §3.3): a control per D2 domain, its reason when unavailable, and Reset.
import type { Action, Field } from './capabilities.ts';

// Controls the page builds by hand (colour pickers, shape list); they move here as their tests are ported.
export const HAND_BUILT = new Set(['label', 'shape', 'fill', 'stroke']);
const DEFAULT = "D2's default";

function control(f: Field): HTMLInputElement | HTMLSelectElement {
  const { domain } = f;
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
    input.type = 'number';
    input.step = 'any';
    if (domain.min !== undefined) input.min = String(domain.min);
    if (domain.max !== undefined) input.max = String(domain.max);
  }
  return input;
}

function build(f: Field) {
  const label = document.createElement('label'), el = control(f);
  el.dataset.path = f.path;
  el.disabled = !f.available;
  const reset = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Reset', title: `Remove ${f.keyword}; D2's default applies` });
  reset.dataset.reset = f.path;
  const row = Object.assign(document.createElement('span'), { className: 'color' });
  row.append(el, reset);
  label.append(f.keyword, row);
  if (f.reason) label.append(Object.assign(document.createElement('small'), { textContent: f.reason }));
  if (f.note) label.append(Object.assign(document.createElement('small'), { textContent: f.note }));
  label.querySelector('small')?.setAttribute('data-reason', f.path);
  return label;
}

// Rebuilds only when the set of fields or their availability changes, so a focused control keeps its place across compiles.
export function renderFields(host: HTMLElement, fields: Field[]) {
  const signature = fields.map(f => `${f.path}${f.available}${f.reason ?? ''}${f.note ?? ''}`).join('|');
  if (host.dataset.signature !== signature) {
    host.dataset.signature = signature;
    host.replaceChildren(...fields.map(build));
  }
  for (const f of fields) {
    const el = host.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-path="${CSS.escape(f.path)}"]`);
    if (el && el !== document.activeElement) el.value = f.value ?? '';
    host.querySelector<HTMLElement>(`[data-reset="${CSS.escape(f.path)}"]`)!.hidden = f.value === undefined || Boolean(f.note);
  }
}

/** Every action with its status, so an unavailable one shows D2's reason instead of vanishing. */
export function renderActions(host: HTMLElement, actions: Action[]) {
  host.replaceChildren(...actions.flatMap(a => {
    const dd = Object.assign(document.createElement('dd'), { textContent: a.available ? 'available' : a.reason });
    dd.classList.toggle('default', a.available);
    return [Object.assign(document.createElement('dt'), { textContent: a.label }), dd];
  }));
}
