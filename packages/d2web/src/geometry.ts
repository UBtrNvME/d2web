import type { Primitive, SceneDocument, SceneNode } from './scene.ts';
import type { Association } from './protocol.ts';

type Extent = [number, number, number, number];
// Conservative paint extents used for mask rasters, not a replacement for D2's layout boxes.
export function primBounds(p: Primitive | null): Extent | null {
  if (!p) return null;
  const pad = 'Stroke' in p && p.Stroke?.Paint && p.Stroke.Width > 0 ? p.Stroke.Width * 2 : 0;
  if (p.$ === 'Rect' || p.$ === 'Image') return [p.Box.X - pad, p.Box.Y - pad, p.Box.X + p.Box.Width + pad, p.Box.Y + p.Box.Height + pad];
  if (p.$ === 'Ellipse') return [p.Center.X - p.RadiusX - pad, p.Center.Y - p.RadiusY - pad, p.Center.X + p.RadiusX + pad, p.Center.Y + p.RadiusY + pad];
  if (p.$ === 'Path') {
    const b: Extent = [Infinity, Infinity, -Infinity, -Infinity];
    for (const c of p.Commands) for (const q of c.Kind === 5 ? [] : [c.P1, ...(c.Kind >= 2 && c.Kind <= 3 ? [c.P2] : []), ...(c.Kind === 3 ? [c.P3] : [])]) {
      const r = c.Kind === 4 ? Math.max(c.RadiusX, c.RadiusY) : 0;
      b[0] = Math.min(b[0], q.X - r - pad); b[1] = Math.min(b[1], q.Y - r - pad); b[2] = Math.max(b[2], q.X + r + pad); b[3] = Math.max(b[3], q.Y + r + pad);
    }
    return b[0] === Infinity ? null : b;
  }
  if (p.$ === 'TextRun') { const w = p.Text.length * p.Font.Size; return [p.Origin.X - w, p.Origin.Y - 2 * p.Font.Size, p.Origin.X + w, p.Origin.Y + p.Font.Size]; }
  return null;
}

export function subtreeBounds(n: SceneNode): Extent | null {
  let b = primBounds(n.Primitive);
  for (const c of n.Children ?? []) {
    const cb = subtreeBounds(c);
    if (!cb) continue;
    const m = c.Transform;
    for (const [x, y] of [[cb[0], cb[1]], [cb[2], cb[1]], [cb[0], cb[3]], [cb[2], cb[3]]]) {
      const X = m.A * x + m.C * y + m.E, Y = m.B * x + m.D * y + m.F;
      b = b ? [Math.min(b[0], X), Math.min(b[1], Y), Math.max(b[2], X), Math.max(b[3], Y)] : [X, Y, X, Y];
    }
  }
  return b;
}

// The owner D2 added each link region for (association `links`, spec 0004). A region without one stays unowned rather than guessed.
export function linkOwners(scene: SceneDocument, association: Association): (string | undefined)[] {
  const owners: (string | undefined)[] = [];
  for (const o of association.objects) for (const i of o.links ?? []) owners[i] = o.id;
  return (scene.Links ?? []).map((_, i) => owners[i]);
}
