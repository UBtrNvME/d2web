export type Point = { X: number; Y: number };
type Box = Point & { Width: number; Height: number };
type Matrix = { A: number; B: number; C: number; D: number; E: number; F: number };
export type Paint = { Color: { R: number; G: number; B: number; A: number } } | null;
export type Stroke = {
  Paint: Paint; Width: number; Cap: 0 | 1 | 2; Join: 0 | 1 | 2;
  MiterLimit: number; Dashes: number[] | null; DashOffset: number;
} | null;
type Appearance = { Fill: Paint; Stroke: Stroke };
type Common = { ID: string; Transform: Matrix; Opacity: number; Children: GeometryNode[] | null };
export type GeometryNode = Common & (
  | { Kind: 'group'; Primitive: null }
  | { Kind: 'rect'; Primitive: Appearance & { Box: Box; RadiusX: number; RadiusY: number } }
  | { Kind: 'ellipse'; Primitive: Appearance & { Center: Point; RadiusX: number; RadiusY: number } }
  | { Kind: 'path'; Primitive: Appearance & { FillRule: 0 | 1; Commands: { Kind: 0 | 1 | 5; P1: Point }[] } }
);
export type GeometryScene = { ViewBox: Box; LogicalWidth: number; LogicalHeight: number; Root: GeometryNode };

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid geometry scene: ${message}`);
}
function object(value: unknown): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected object');
}
function finite(value: unknown, minimum = -Infinity): asserts value is number {
  check(typeof value === 'number' && Number.isFinite(value) && value >= minimum, 'invalid number');
}
function empty(value: unknown) {
  return value === null || (Array.isArray(value) && value.length === 0);
}
function point(value: unknown) {
  object(value); finite(value.X); finite(value.Y);
}
function box(value: unknown): asserts value is Box {
  object(value); point(value); finite(value.Width, 0); finite(value.Height, 0);
}
function paint(value: unknown) {
  if (value === null) return;
  object(value); object(value.Color);
  check(Object.keys(value).length === 1, 'unsupported paint');
  for (const channel of ['R', 'G', 'B', 'A']) {
    const byte = value.Color[channel];
    check(typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255, 'invalid color channel');
  }
}
function appearance(value: Record<string, unknown>) {
  paint(value.Fill);
  if (value.Stroke === null) return;
  object(value.Stroke);
  const stroke = value.Stroke;
  paint(stroke.Paint); finite(stroke.Width, 0); finite(stroke.MiterLimit, 0); finite(stroke.DashOffset);
  check([0, 1, 2].includes(stroke.Cap as number) && [0, 1, 2].includes(stroke.Join as number), 'unsupported stroke');
  check(stroke.Dashes === null || Array.isArray(stroke.Dashes), 'invalid dashes');
  for (const dash of stroke.Dashes ?? []) finite(dash, 0);
}

// shortcut: this contract covers solid geometry only; extend alongside native comparison cases.
export function parseGeometryScene(input: unknown): GeometryScene {
  object(input); box(input.ViewBox); finite(input.LogicalWidth, Number.MIN_VALUE); finite(input.LogicalHeight, Number.MIN_VALUE);
  finite(input.ViewBox.Width, Number.MIN_VALUE); finite(input.ViewBox.Height, Number.MIN_VALUE);
  check(input.ViewportFit === 1 && input.ViewportAlign === 0, 'unsupported viewport');
  object(input.Assets);
  check(Object.keys(input.Assets).length === 0 && empty(input.Links), 'unsupported assets or links');
  let count = 0, commands = 0;
  function node(value: unknown, depth: number) {
    check(++count <= 10000 && depth <= 128, 'node budget exceeded');
    object(value);
    check(typeof value.ID === 'string', 'missing object identity');
    finite(value.Opacity, 0); check(value.Opacity <= 1, 'invalid opacity');
    check(value.Blend === 0 && value.Clip === null && value.Mask === null
      && empty(value.Filters) && empty(value.Animations), 'unsupported effects');
    object(value.Transform);
    for (const field of ['A', 'B', 'C', 'D', 'E', 'F']) finite(value.Transform[field]);
    const primitive = value.Primitive;
    if (value.Kind === 'group') check(primitive === null, 'group has primitive');
    else {
      object(primitive); appearance(primitive);
      switch (value.Kind) {
        case 'rect': box(primitive.Box); finite(primitive.RadiusX, 0); finite(primitive.RadiusY, 0); break;
        case 'ellipse': point(primitive.Center); finite(primitive.RadiusX, 0); finite(primitive.RadiusY, 0); break;
        case 'path': {
          check(primitive.FillRule === 0 || primitive.FillRule === 1, 'invalid fill rule');
          check(Array.isArray(primitive.Commands), 'invalid path');
          commands += primitive.Commands.length;
          check(commands <= 100000, 'path budget exceeded');
          let hasMove = false;
          for (const command of primitive.Commands) {
            object(command);
            check(command.Kind === 0 || command.Kind === 1 || command.Kind === 5, 'unsupported path command');
            if (command.Kind === 0) hasMove = true;
            check(hasMove, 'path starts before move');
            if (command.Kind !== 5) point(command.P1);
          }
          break;
        }
        default: throw new Error('Invalid geometry scene: unsupported primitive');
      }
    }
    check(value.Children === null || Array.isArray(value.Children), 'invalid children');
    for (const child of value.Children ?? []) node(child, depth + 1);
  }
  node(input.Root, 0);
  return input as GeometryScene;
}
