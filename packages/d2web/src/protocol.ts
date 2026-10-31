// Message types for spec 0001 (docs/specs/0001-compile-protocol.md). Types only; the spec is the contract, this file mirrors it.
export const PROTOCOL_VERSION = 1;

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
}

export interface CompileRequest {
  v: typeof PROTOCOL_VERSION;
  type: 'compile';
  id: number;
  revision: number;
  files: Record<string, string>;
  entry: string;
  layout?: Engine;
  render: RenderOptions;
  budgets?: Budgets;
  // Default is the root board only.
  boards?: string[] | 'all';
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  board?: string;
  file?: string;
  range?: { start: number; end: number };
}

export interface BoardResult {
  path: string;
  scene: unknown; // designed scene encoding, versioned by sceneVersion (not built yet)
  association: unknown; // keyed by (revision, board path, object ID)
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
  echo: { layout: Engine; render: RenderOptions };
}

export type HostMessage = CompileRequest;
export type WorkerMessage = WorkerReady | CompileResult;
