import type { GeometryNode, GeometryScene as Scene, Paint, Stroke } from './geometry-scene.js';

function color(paint: Paint) {
  if (paint === null) return 'none';
  const { R, G, B, A } = paint.Color;
  return `rgba(${R}, ${G}, ${B}, ${A / 255})`;
}
function stroke(value: Stroke) {
  if (value === null) return { stroke: 'none' };
  return {
    stroke: color(value.Paint), strokeWidth: value.Width,
    strokeLinecap: (['butt', 'round', 'square'] as const)[value.Cap],
    strokeLinejoin: (['miter', 'round', 'bevel'] as const)[value.Join],
    // SVG and D2 use 4 when the native stroke has no explicit miter limit.
    strokeMiterlimit: value.MiterLimit || 4,
    strokeDasharray: value.Dashes?.join(' ') ?? 'none', strokeDashoffset: value.DashOffset,
  };
}
function Primitive({ node }: { node: GeometryNode }) {
  if (node.Kind === 'group') return null;
  const p = node.Primitive;
  const appearance = { fill: color(p.Fill), ...stroke(p.Stroke) };
  switch (node.Kind) {
    case 'rect': {
      const { Box: b, RadiusX, RadiusY } = node.Primitive;
      return <rect x={b.X} y={b.Y} width={b.Width} height={b.Height} rx={RadiusX} ry={RadiusY} {...appearance} />;
    }
    case 'ellipse': {
      const { Center, RadiusX, RadiusY } = node.Primitive;
      return <ellipse cx={Center.X} cy={Center.Y} rx={RadiusX} ry={RadiusY} {...appearance} />;
    }
    case 'path': {
      const d = node.Primitive.Commands.map(c => c.Kind === 5 ? 'Z' : `${c.Kind === 0 ? 'M' : 'L'}${c.P1.X} ${c.P1.Y}`).join(' ');
      return <path d={d} fillRule={node.Primitive.FillRule === 0 ? 'nonzero' : 'evenodd'} {...appearance} />;
    }
  }
}
function Node({ node }: { node: GeometryNode }) {
  const m = node.Transform;
  return <g data-d2-id={node.ID || undefined} opacity={node.Opacity} transform={`matrix(${m.A} ${m.B} ${m.C} ${m.D} ${m.E} ${m.F})`}>
    <Primitive node={node} />
    {node.Children?.map((child, i) => <Node key={child.ID ? `id:${child.ID}` : `index:${i}`} node={child} />)}
  </g>;
}

export function GeometryScene({ scene, label }: { scene: Scene; label: string }) {
  const b = scene.ViewBox;
  return <svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label={label} data-d2-scene=""
    width={scene.LogicalWidth} height={scene.LogicalHeight} viewBox={`${b.X} ${b.Y} ${b.Width} ${b.Height}`}
    preserveAspectRatio="xMinYMin meet" style={{ display: 'block' }}>
    <Node node={scene.Root} />
  </svg>;
}
