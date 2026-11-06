import type { Association } from '../../d2web/src/index.ts';
import { buildOutline, type OutlineRow } from './outline.ts';
import { property } from './capabilities.ts';
import { kindOf } from './kinds/index.ts';
import table from './keywords.json' with { type: 'json' };

export function valueSources(object: Association['objects'][number]) {
  return Object.entries(object.properties).flatMap(([name, held]) => {
    const source = held.source;
    if (held.inherited !== true || !source) return [];
    const keyword = table.keywords.find(k => property(k.name) === name || k.name === name)?.name ?? name;
    return [{ name: keyword, value: held.value, path: source.path, line: source.start.line + 1, offset: held.literal?.start.offset ?? source.start.offset }];
  });
}

export function outlineView(host: HTMLDetailsElement, options: { linked: () => boolean; jump: (id: string) => void; source: (offset: number) => void; entry: string }) {
  const tree = document.createElement('ul'), collapsed = new Set<string>();
  tree.setAttribute('role', 'tree');
  tree.setAttribute('aria-label', 'Outline');
  host.append(tree);
  host.open = !matchMedia('(max-width: 800px)').matches;
  let objects = new Map<string, Association['objects'][number]>(), current = '', roving = '';
  const items = () => [...tree.querySelectorAll<HTMLElement>('[role=treeitem]')];
  const visible = () => items().filter(el => !el.closest('[hidden]'));
  function focus(el: HTMLElement) {
    roving = el.dataset.id!;
    for (const item of items()) item.tabIndex = item === el ? 0 : -1;
    el.focus();
  }
  function expand(el: HTMLElement, open: boolean) {
    const group = el.querySelector<HTMLElement>(':scope > [role=group]');
    if (!group) return;
    group.hidden = !open;
    el.setAttribute('aria-expanded', String(open));
    el.querySelector<HTMLElement>(':scope > .outline-row > .outline-toggle')!.textContent = open ? '▾' : '▸';
    if (open) collapsed.delete(el.dataset.id!); else collapsed.add(el.dataset.id!);
  }
  function provenance() {
    tree.querySelector('.provenance')?.remove();
    const object = objects.get(current), row = items().find(el => el.dataset.id === current);
    if (!object || !row) return;
    const inherited = valueSources(object);
    if (!inherited.length) return;
    const details = document.createElement('details'), summary = document.createElement('summary');
    details.className = 'provenance';
    summary.textContent = 'Value sources';
    details.append(summary);
    for (const value of inherited) {
      const line = document.createElement('div'), control = document.createElement(value.path === options.entry ? 'button' : 'span');
      control.textContent = `${value.name}: ${value.value} (line ${value.line})`;
      if (control instanceof HTMLButtonElement) {
        control.type = 'button';
        control.onclick = () => { if (options.linked()) options.source(value.offset); };
      }
      line.append(control);
      details.append(line);
    }
    row.querySelector('.outline-row')!.after(details);
  }
  tree.onkeydown = event => {
    const el = (event.target as HTMLElement).closest<HTMLElement>('[role=treeitem]');
    if (!el || (event.target as HTMLElement).closest('.provenance')) return;
    const rows = visible(), index = rows.indexOf(el);
    if (event.key === 'ArrowDown') focus(rows[Math.min(rows.length - 1, index + 1)]);
    else if (event.key === 'ArrowUp') focus(rows[Math.max(0, index - 1)]);
    else if (event.key === 'ArrowRight') {
      if (el.getAttribute('aria-expanded') === 'false') expand(el, true);
      else if (el.getAttribute('aria-expanded') === 'true') focus(rows[index + 1]);
    } else if (event.key === 'ArrowLeft') {
      if (el.getAttribute('aria-expanded') === 'true') expand(el, false);
      else { const parent = el.parentElement?.closest<HTMLElement>('[role=treeitem]'); if (parent) focus(parent); }
    } else if (event.key === 'Enter') { if (options.linked()) options.jump(el.dataset.id!); }
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  function render(rows: OutlineRow[], parent: HTMLElement, depth = 0) {
    for (const row of rows) {
      const item = document.createElement('li'), line = document.createElement('div'), button = document.createElement('button');
      item.setAttribute('role', 'treeitem');
      item.setAttribute('aria-label', row.label);
      item.dataset.id = row.id;
      item.tabIndex = -1;
      line.style.setProperty('--depth', String(depth));
      line.className = 'outline-row';
      if (row.children.length) {
        const toggle = document.createElement('button');
        toggle.type = 'button'; toggle.tabIndex = -1; toggle.className = 'outline-toggle';
        toggle.setAttribute('aria-label', `Expand or collapse ${row.label}`);
        toggle.onclick = () => { focus(item); expand(item, item.getAttribute('aria-expanded') !== 'true'); };
        line.append(toggle);
      }
      button.type = 'button'; button.tabIndex = -1; button.textContent = row.label;
      button.onclick = () => { focus(item); if (options.linked() && row.offset !== undefined) options.jump(row.id); };
      line.append(button);
      if (row.children.length) line.append(Object.assign(document.createElement('small'), { textContent: kindOf(objects.get(row.id)!)?.label ?? row.kind }));
      item.append(line);
      parent.append(item);
      if (row.children.length) {
        const group = document.createElement('ul');
        group.setAttribute('role', 'group');
        item.append(group);
        render(row.children, group, depth + 1);
        expand(item, !collapsed.has(row.id));
      }
    }
  }
  return {
    refresh(next: Association | undefined) {
      const focused = tree.contains(document.activeElement);
      const disclosure = tree.querySelector<HTMLDetailsElement>('.provenance')?.open;
      objects = new Map((next?.objects ?? []).map(o => [o.id, o]));
      tree.replaceChildren();
      host.querySelector<HTMLElement>(':scope > .empty')!.hidden = Boolean(next?.objects.length);
      render(next ? buildOutline(next) : [], tree);
      const row = visible().find(el => el.dataset.id === roving) ?? visible()[0];
      if (row) { row.tabIndex = 0; if (focused) focus(row); }
      for (const item of items()) if (item.dataset.id === current) item.setAttribute('aria-current', 'true');
      provenance();
      const details = tree.querySelector<HTMLDetailsElement>('.provenance');
      if (details && disclosure) details.open = true;
    },
    current(id: string) {
      if (current === id) return;
      current = id;
      for (const item of items()) {
        if (item.dataset.id === id) {
          item.setAttribute('aria-current', 'true');
          for (let parent = item.parentElement?.closest<HTMLElement>('[role=treeitem]'); parent; parent = parent.parentElement?.closest<HTMLElement>('[role=treeitem]')) expand(parent, true);
        } else item.removeAttribute('aria-current');
      }
      provenance();
    },
  };
}
