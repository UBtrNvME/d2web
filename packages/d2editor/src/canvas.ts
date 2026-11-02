// The editor's viewport (d2web's mount leaves zoom and pan to its consumer, spec 0002): a translate and a scale on the host.
export type View = { x: number; y: number; k: number };
export const MIN = 0.1, MAX = 8;

const clamp = (k: number) => Math.min(MAX, Math.max(MIN, k));

// Zoom to `k` keeping the point (px, py) of the viewport fixed.
export function zoomAt(v: View, k: number, px: number, py: number): View {
  k = clamp(k);
  return { x: px - (px - v.x) * k / v.k, y: py - (py - v.y) * k / v.k, k };
}

// Centre a w×h diagram in a W×H viewport, enlarging a small one up to 200%.
export function fit(w: number, h: number, W: number, H: number, pad = 32): View {
  const k = w && h ? clamp(Math.min(2, (W - 2 * pad) / w, (H - 2 * pad) / h)) : 1;
  return { x: (W - w * k) / 2, y: (H - h * k) / 2, k };
}

export function canvas(viewport: HTMLElement, content: HTMLElement, grid: HTMLElement, onChange: (v: View) => void) {
  let v: View = { x: 0, y: 0, k: 1 };
  const set = (next: View) => {
    v = next;
    content.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    // As the demo: 1px dots every 20px that scale with zoom and fade out when zoomed far out, on a sibling layer so pan frames restyle nothing in the board.
    const gap = 20 * v.k;
    grid.style.setProperty('--dot-a', (0.22 * Math.min(1, Math.max(0, (v.k - 0.25) / 0.35))).toFixed(3));
    grid.style.setProperty('--dot-r', `${Math.min(1.5, Math.max(0.5, 0.5 * v.k)).toFixed(2)}px`);
    grid.style.setProperty('--gap', `${gap}px`);
    grid.style.setProperty('--px', `${v.x % gap}px`);
    grid.style.setProperty('--py', `${v.y % gap}px`);
    onChange(v);
  };
  const centre = () => ({ px: viewport.clientWidth / 2, py: viewport.clientHeight / 2 });
  const zoomBy = (factor: number, px = centre().px, py = centre().py) => set(zoomAt(v, v.k * factor, px, py));

  // Ctrl/Cmd+wheel and trackpad pinch (which arrives as ctrlKey wheel) zoom at the pointer; a plain wheel pans.
  viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    // A mouse notch (~100) is capped to the step a pinch makes over a few events.
    if (e.ctrlKey || e.metaKey) zoomBy(Math.exp(-Math.max(-25, Math.min(25, e.deltaY)) * 0.01), e.clientX - r.left, e.clientY - r.top);
    else set({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
  }, { passive: false });

  // Dragging anywhere pans; a press that moves less than 4px stays a click, so selection keeps working.
  let drag: { id: number; sx: number; sy: number; x: number; y: number; moved: boolean } | undefined, panned = false;
  viewport.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.button !== 1) return;
    panned = false;
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: v.x, y: v.y, moved: false };
  });
  viewport.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { drag.moved = true; viewport.setPointerCapture(e.pointerId); viewport.classList.add('panning'); }
    set({ ...v, x: drag.x + dx, y: drag.y + dy });
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    viewport.classList.remove('panning');
    panned = drag.moved;
    drag = undefined;
  };
  // The click after a pan must not select or deselect; the next press clears the flag if no click came.
  viewport.addEventListener('click', e => { if (panned) { panned = false; e.stopPropagation(); } }, { capture: true });
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);

  return {
    get view() { return v; },
    // True while a press is down: pointer focus waits for the click, which a pan cancels.
    get pressed() { return Boolean(drag); },
    zoomBy,
    reset: () => { const { px, py } = centre(); set(zoomAt(v, 1, px, py)); },
    fit: () => set(fit(content.offsetWidth, content.offsetHeight, viewport.clientWidth, viewport.clientHeight)),
    // Keep a keyboard-focused object on screen: the viewport clips instead of scrolling.
    reveal(el: Element) {
      // Ownership frames can be zero-sized and each path's 1×1 <svg> wrapper sits at the scene origin: use the union of the other painted parts.
      const rects = [el, ...el.querySelectorAll('*')].filter(e => e.localName !== 'svg').map(e => e.getBoundingClientRect()).filter(q => q.width || q.height);
      if (!rects.length) return;
      const r = { left: Math.min(...rects.map(q => q.left)), top: Math.min(...rects.map(q => q.top)), right: Math.max(...rects.map(q => q.right)), bottom: Math.max(...rects.map(q => q.bottom)) };
      const b = viewport.getBoundingClientRect(), m = 24;
      const dx = r.left < b.left + m ? b.left + m - r.left : r.right > b.right - m ? b.right - m - r.right : 0;
      const dy = r.top < b.top + m ? b.top + m - r.top : r.bottom > b.bottom - m ? b.bottom - m - r.bottom : 0;
      if (dx || dy) set({ ...v, x: v.x + dx, y: v.y + dy });
    },
  };
}
