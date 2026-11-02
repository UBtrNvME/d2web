// Scene encoding v1: the closed types in d2web-wasm/scenejson, pinned to D2 v0.9.0.
// Coordinates are D2 logical pixels; matrices map node-local coordinates to their parent. Durations are nanoseconds.
export type Point = Readonly<{ X: number; Y: number }>;
export type Box = Readonly<{ X: number; Y: number; Width: number; Height: number }>;
export type Bounds = Readonly<{ Min: Point; Max: Point; Valid: boolean }>;
export type Matrix = Readonly<{ A: number; B: number; C: number; D: number; E: number; F: number }>;
export type Color = string; // rgba(r,g,b,a), resolved by D2

export type SolidPaint = Readonly<{ $: 'SolidPaint'; Color: Color }>;
export type GradientStop = Readonly<{ Offset: number; Color: Color }>;
type Gradient = Readonly<{ Stops: readonly GradientStop[]; Units: 0 | 1; Transform: Matrix; Spread: 0 | 1 | 2 }>;
export type LinearGradient = Gradient & Readonly<{ $: 'LinearGradient'; Start: Point; End: Point }>;
export type RadialGradient = Gradient & Readonly<{ $: 'RadialGradient'; Center: Point; Radius: number; Focal: Point; FocalRadius: number }>;
export type PatternPaint = Readonly<{ $: 'PatternPaint'; Tile: Box; Root: SceneNode; Units: 0 | 1; Transform: Matrix }>;
export type Paint = SolidPaint | LinearGradient | RadialGradient | PatternPaint;
export type Stroke = Readonly<{ Paint: Paint | null; Width: number; Cap: 0 | 1 | 2; Join: 0 | 1 | 2; MiterLimit: number; Dashes: readonly number[]; DashOffset: number }>;

export type PathCommand = Readonly<{ Kind: 0 | 1 | 2 | 3 | 4 | 5; P1: Point; P2: Point; P3: Point; RadiusX: number; RadiusY: number; Rotation: number; LargeArc: boolean; Sweep: boolean }>;
type Painted = Readonly<{ Fill: Paint | null; Stroke: Stroke | null }>;
export type Rect = Painted & Readonly<{ $: 'Rect'; Box: Box; RadiusX: number; RadiusY: number }>;
export type Ellipse = Painted & Readonly<{ $: 'Ellipse'; Center: Point; RadiusX: number; RadiusY: number }>;
export type Path = Painted & Readonly<{ $: 'Path'; Commands: readonly PathCommand[]; FillRule: 0 | 1 }>;
export type SceneFont = Readonly<{ Family: string; Style: string; Weight: number; Size: number; Asset: string }>;
export type Glyph = Readonly<{ ID: number; Empty: boolean; Asset: string; Position: Point; Advance: number; Ink: Bounds }>;
export type TextRun = Painted & Readonly<{ $: 'TextRun'; Text: string; Origin: Point; Anchor: 0 | 1 | 2; Font: SceneFont; Fallbacks: readonly string[]; Underline: boolean; Strike: boolean; Glyphs: readonly Glyph[]; Ink: Bounds }>;
export type AspectRatio = Readonly<{ Align: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9; Fit: 0 | 1 }>;
export type SceneImage = Readonly<{ $: 'Image'; Asset: string; Box: Box; Aspect: AspectRatio }>;
export type Primitive = Rect | Ellipse | Path | TextRun | SceneImage;

// Font bytes travel beside the scene in CompileResult.fonts; raster bytes are base64 in JSON.
export type FontAsset = Readonly<{ $: 'FontAsset'; MIMEType: string; FaceIndex: number }>;
export type RasterAsset = Readonly<{ $: 'RasterAsset'; MIMEType: string; Data: string; PixelWidth: number; PixelHeight: number; DecodedBytes: number }>;
export type VectorAsset = Readonly<{ $: 'VectorAsset'; ViewBox: Box; Root: SceneNode }>;
export type Asset = FontAsset | RasterAsset | VectorAsset;
export type LinkRegion = Readonly<{ Box: Box; URL: string; Tooltip: string; Target: string }>;
export type Clip = Readonly<{ Path: Path; Transform: Matrix }>;
export type Mask = Readonly<{ Type: 0 | 1; Root: SceneNode; Transform: Matrix }>;
export type GaussianBlur = Readonly<{ $: 'GaussianBlur'; SigmaX: number; SigmaY: number }>;
export type DropShadow = Readonly<{ $: 'DropShadow'; OffsetX: number; OffsetY: number; SigmaX: number; SigmaY: number; Color: Color }>;
export type Filter = GaussianBlur | DropShadow;

export type AnimationValue = Readonly<{ Kind: 0 | 1 | 2 | 3; Number: number; Transform: Matrix; Color: Color; Shadow: DropShadow }>;
export type Easing = Readonly<{ Kind: 0 | 1 | 2 | 3; X1: number; Y1: number; X2: number; Y2: number }>;
export type Keyframe = Readonly<{ Offset: number; Value: AnimationValue; Easing: Easing }>;
export type Track = Readonly<{ Property: 0 | 1 | 2 | 3 | 4 | 5; TargetIndex: number; Delay: number; Duration: number; Repeat: boolean; Keyframes: readonly Keyframe[] }>;
export type SceneNode = Readonly<{
  ID: string; Classes: readonly string[]; Transform: Matrix; Opacity: number; Blend: 0 | 1 | 2 | 3 | 4 | 5;
  Clip: Clip | null; Mask: Mask | null; Filters: readonly Filter[]; Primitive: Primitive | null;
  Children: readonly SceneNode[]; Animations: readonly Track[];
}>;
export type SceneDocument = Readonly<{
  ViewBox: Box; LogicalWidth: number; LogicalHeight: number; ViewportFit: 0 | 1; ViewportAlign: 0 | 1;
  Root: SceneNode; Assets: Readonly<Record<string, Asset>>; Links: readonly LinkRegion[];
}>;
