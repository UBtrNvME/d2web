// Message types for spec 0001 (docs/specs/0001-compile-protocol.md). Types only; the spec is the contract, this file mirrors it.
import type { SceneDocument } from './scene.ts';

export const PROTOCOL_VERSION = 2;
export const SCENE_VERSION = 1;

export type Engine = 'tala' | 'dagre' | 'elk';

export interface RenderOptions {
  themeId: number;
  themeOverrides?: Record<string, string>;
  sketch: boolean;
  pad: number;
  scale: number;
  center: boolean;
}

// Every field optional: the worker supplies defaults; a request may lower or raise them.
export interface Budgets {
  maxNodes?: number;
  maxLayoutMillis?: number;
  maxPathCommands?: number;
  sketch?: { maxOperationSets?: number; maxOperations?: number; maxPathCommands?: number };
  links?: { maxRegions?: number; maxStringBytes?: number };
  svgImport?: Record<string, number>;
}

export interface WorkerReady {
  v: typeof PROTOCOL_VERSION;
  type: 'ready';
  d2: string;
  engines: Engine[];
  sceneVersion: number;
  // True when the wasm was built from a D2 checkout with docs/upstream patches applied.
  patched: boolean;
  // Spec 0012: the worker serves `edit` requests.
  edit: boolean;
}

export interface CompileRequest {
  v: typeof PROTOCOL_VERSION;
  type: 'compile';
  id: number;
  revision: number;
  files: Record<string, string>;
  entry: string;
  layout?: Engine;
  // TALA attempts, as `d2 --tala-seeds`: every seed is laid out and the best result kept. Default [1, 2, 3] (the d2 CLI default); fewer is faster.
  // A diagram's own `vars.d2-config.data.tala-seeds` takes precedence, as natively. Ignored by dagre and ELK.
  seeds?: number[];
  render: RenderOptions;
  budgets?: Budgets;
  // Default is the root board only.
  boards?: string[] | 'all';
  // Spec 0010: image bytes the page resolved, by the link exactly as the preflight reported it. Present (even empty) means bundle mode: the worker
  // serves these to D2's image resolver and warns about every link it was not given. Absent: nothing is fetched or reported.
  images?: Record<string, ImageBytes>;
  // Spec 0010 2.3: also report, per object, the link of every image that was not supplied, so the painter can show it as an image element (link mode, or
  // bundle with fallback 'link'). Set by the client from its `images` option.
  linkImages?: boolean;
}

export interface ImageBytes { type: string; data: Uint8Array }

// Spec 0010: which image links does this source use? Answered without layout. `board` is a compile result path ("" or "/layers/x"), `kind` the
// D2 role, `source` D2's own string for the link. `error` is a D2 error in the source (no links then; the compile that follows reports it).
export interface PreflightRequest { v: typeof PROTOCOL_VERSION; type: 'preflight'; id: number; files: Record<string, string>; entry: string }
export interface ImageLink { board: string; id: string; kind: 'icon' | 'image' | 'edge-icon'; source: string }
export interface PreflightResult { v: typeof PROTOCOL_VERSION; type: 'images'; id: number; links: ImageLink[]; error?: string }

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  board?: string;
  file?: string;
  range?: { start: number; end: number };
  // Machine-readable kind, additive (spec 0010): 'image-unresolved'.
  code?: 'image-unresolved';
}

export interface BoardResult {
  path: string;
  scene: SceneDocument; // closed scene encoding v1, independent of any DOM or framework
  association: Association; // keyed by (revision, board path, object ID); spec 0004
}

export type ErrorCode = 'compile' | 'budget' | 'layout' | 'internal';

export interface CompileResult {
  v: typeof PROTOCOL_VERSION;
  type: 'result';
  id: number;
  revision: number;
  millis: number;
  // Boards that exist, so a consumer knows what it may request.
  available: string[];
  // Absent on failure: a failed compile never returns partial scenes.
  boards?: BoardResult[];
  // Font bytes by asset ID, deduplicated across boards.
  fonts?: Record<string, Uint8Array | string>;
  error?: { code: ErrorCode; message: string; diagnostics: Diagnostic[] };
  diagnostics: Diagnostic[];
  // Kroki's encoding of the source (zlib level 9, URL-safe base64), for a request with exactly one file; absent otherwise.
  identity?: string;
  echo: { layout: Engine; seeds: number[]; render: RenderOptions; images?: 'bundle' | 'link' };
}

// Spec 0007: a fallback font the consumer approved (ADR 0006); the client fetches it, checks `sha256` when given and posts the bytes to the worker once.
export interface FontSpec { name: string; url: string; sha256?: string }
export interface FontsMessage { type: 'fonts'; fonts: { name: string; data: Uint8Array }[]; emoji?: Uint8Array }
// The worker's answer to a fonts message: `error` is the reason the wasm refused them (a file that is not a font).
export interface FontsAck { type: 'fonts'; error: string }

// Spec 0012: D2 edit operations in, a checked patch to the author's text out. `board` is a compile result path; offsets are UTF-16.
export type EditOp =
  | { op: 'set'; key: string; value: string | null; tag?: string }
  | { op: 'create'; key: string }
  | { op: 'delete'; key: string }
  | { op: 'rename'; key: string; name: string }
  | { op: 'move'; key: string; parent: string };
export interface EditRequest { v: typeof PROTOCOL_VERSION; type: 'edit'; id: number; revision: number; files: Record<string, string>; entry: string; board?: string; ops: EditOp[] }
export type EditErrorCode = 'compile' | 'edit' | 'panic' | 'recompile' | 'unchecked' | 'internal' | 'stale';
export interface EditResult {
  v: typeof PROTOCOL_VERSION;
  type: 'edited';
  id: number;
  revision: number;
  millis: number;
  // Absent on failure: nothing is published.
  patch?: { file: string; edits: { start: number; end: number; text: string }[]; text: string };
  ids: { created: string[]; renamed: Record<string, string>; deleted: string[] };
  diagnostics: Diagnostic[];
  // `formatted` and `reason` only for 'unchecked': D2's formatted whole file, offered for the user to approve, never applied.
  error?: { code: EditErrorCode; message: string; op?: number; formatted?: string; reason?: 'conflict' | 'inequivalent' | 'label'; labels?: string[] };
}

export type HostMessage = CompileRequest | FontsMessage | PreflightRequest | EditRequest;
export type WorkerMessage = WorkerReady | CompileResult | FontsAck | PreflightResult | EditResult;

// Spec 0004. Positions are D2's with UTF-16 positions enabled: line and column 0-based, offset from the start of the file, all in UTF-16 code
// units, so `offset` is a JS string index. Diagnostic ranges use the same offsets.
export interface Pos { line: number; column: number; offset: number }
export interface Source { path: string; start: Pos; end: Pos }
export interface AssociationObject {
  id: string;
  kind: 'shape' | 'connection';
  parent?: string;
  label: string;
  content?: 'markdown' | 'code' | 'latex' | 'sql_table' | 'class';
  nodes: string[];
  references: Source[];
  properties: Record<string, { value: string; source: Source | null }>;
  src?: string;
  dst?: string;
  // Spec 0010: the link of an image the scene could not carry; `node` is the placeholder's scene node (<id>:icon, <id>:image for `shape: image`).
  image?: { source: string; role: 'icon' | 'image' | 'edge-icon'; node: string };
  // D2's markdown HTML (goldmark, as D2 lays it out) with only D2's elements and the attributes D2 reads; absent when the label holds anything else.
  html?: string;
  // The object's outline box in scene coordinates, from D2's exact path geometry.
  box?: { X: number; Y: number; Width: number; Height: number };
  // Indices into the scene's Links that D2 added for this object.
  links?: number[];
}
export interface Association { objects: AssociationObject[] }
