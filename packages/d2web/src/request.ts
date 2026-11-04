import { PROTOCOL_VERSION, type Budgets, type CompileRequest, type EditOp, type EditRequest, type Engine, type FontSpec, type ImageBytes, type RenderOptions } from './protocol.ts';

const ENGINES: readonly Engine[] = ['tala', 'dagre', 'elk'];

// Path of the root board in a compile result (the census keys the root board by the empty path).
export const ROOT_BOARD = '';

// shortcut: placeholder ceilings copied from the research probes (research/census.go); replace with measured defaults when the worker exists.
// The d2 CLI default for --tala-seeds; D2 accepts at most 16 distinct seeds.
export const DEFAULT_SEEDS = [1, 2, 3];
const MAX_SEEDS = 16;

export const DEFAULT_BUDGETS = {
  maxNodes: 100_000,
  // Client side (spec 0008): a compile running longer than this is aborted by terminating the worker; the wasm never sees it.
  maxLayoutMillis: 60_000,
  maxPathCommands: 1_000_000,
  sketch: { maxOperationSets: 100_000, maxOperations: 1_000_000, maxPathCommands: 1_000_000 },
  links: { maxRegions: 10_000, maxStringBytes: 1_000_000 },
  svgImport: {
    maxSourceBytes: 1 << 22, maxElements: 100_000, maxAttributes: 500_000, maxAttributeBytes: 1 << 22, maxPathCommands: 1_000_000,
    maxTransformFunctions: 100_000, maxDeclaredResources: 10_000, maxExpandedUseInstances: 10_000,
  },
};

export type ResolvedBudgets = typeof DEFAULT_BUDGETS;

export interface NormalizedRequest extends CompileRequest {
  layout: Engine;
  seeds: number[];
  budgets: ResolvedBudgets;
  boards: string[] | 'all';
}

export class ProtocolError extends Error {}

// Spec 0007: the consumer's font list, validated before anything is fetched.
export function normalizeFonts(value: unknown): FontSpec[] {
  if (!Array.isArray(value)) throw new ProtocolError('fonts must be an array');
  return value.map((f, i) => {
    const at = `fonts[${i}]`;
    if (!isObject(f)) throw new ProtocolError(`${at} must be an object`);
    for (const key of Object.keys(f)) if (!['name', 'url', 'sha256'].includes(key)) throw new ProtocolError(`unknown ${at}.${key}`);
    if (typeof f.name !== 'string' || !f.name) throw new ProtocolError(`${at}.name must be a non-empty string`);
    if (typeof f.url !== 'string' || !f.url) throw new ProtocolError(`${at}.url must be a non-empty string`);
    if (f.sha256 !== undefined && !(typeof f.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(f.sha256))) throw new ProtocolError(`${at}.sha256 must be 64 hex digits`);
    return { name: f.name, url: f.url, ...(f.sha256 ? { sha256: f.sha256.toLowerCase() } : {}) };
  });
}

const fail = (message: string): never => { throw new ProtocolError(message); };
export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// Shared by compile and edit requests: text files and an entry among them.
function filesAndEntry(files: unknown, entry: unknown) {
  if (!isObject(files) || !Object.values(files).every(f => typeof f === 'string')) fail('files must map paths to text');
  if (typeof entry !== 'string' || !Object.hasOwn(files as object, entry)) fail('entry must name one of the files');
}

function integer(value: unknown, name: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) fail(`${name} must be an integer >= ${min}`);
  return value as number;
}

function render(value: unknown): RenderOptions {
  if (!isObject(value)) fail('render must be an object');
  const r = value as Record<string, unknown>;
  const { themeOverrides } = r;
  if (themeOverrides !== undefined && !(isObject(themeOverrides) && Object.values(themeOverrides).every(v => typeof v === 'string'))) fail('render.themeOverrides must map names to strings');
  if (typeof r.sketch !== 'boolean') fail('render.sketch must be a boolean');
  if (typeof r.center !== 'boolean') fail('render.center must be a boolean');
  if (typeof r.scale !== 'number' || !Number.isFinite(r.scale) || r.scale <= 0) fail('render.scale must be a positive number');
  return {
    themeId: integer(r.themeId, 'render.themeId', -1_000_000), sketch: r.sketch as boolean, pad: integer(r.pad, 'render.pad', 0),
    scale: r.scale as number, center: r.center as boolean, ...(themeOverrides ? { themeOverrides: themeOverrides as Record<string, string> } : {}),
  };
}

// Overlays the request's budget numbers on the defaults; every number must be positive because the scene builder rejects zero.
function overlay<T extends Record<string, unknown>>(defaults: T, given: unknown, path: string): T {
  if (given === undefined) return defaults;
  if (!isObject(given)) return fail(`${path} must be an object`);
  const result: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(given)) {
    if (!(key in defaults)) fail(`unknown budget ${path}.${key}`);
    result[key] = isObject(defaults[key]) ? overlay(defaults[key] as Record<string, unknown>, value, `${path}.${key}`) : integer(value, `${path}.${key}`, 1);
  }
  return result as T;
}

function boards(value: unknown): string[] | 'all' {
  if (value === undefined) return [ROOT_BOARD];
  if (value === 'all') return 'all';
  if (!Array.isArray(value) || value.length === 0 || !value.every(b => typeof b === 'string')) return fail("boards must be 'all' or a non-empty array of board paths");
  return [...new Set(value as string[])];
}

function seeds(value: unknown): number[] {
  if (value === undefined) return [...DEFAULT_SEEDS];
  if (!Array.isArray(value) || value.length === 0 || !value.every(Number.isSafeInteger)) return fail('seeds must be a non-empty array of integers');
  const unique = [...new Set(value as number[])];
  if (unique.length > MAX_SEEDS) fail(`seeds allows at most ${MAX_SEEDS} distinct values`);
  return unique;
}

// Spec 0010: supplied image bytes, by link. Values are checked here so the worker only ever sees bytes with a content type.
function images(value: unknown): Record<string, ImageBytes> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) return fail('images must map links to { type, data }');
  const out: Record<string, ImageBytes> = {};
  for (const [source, image] of Object.entries(value)) {
    if (!isObject(image) || typeof image.type !== 'string' || !(image.data instanceof Uint8Array)) fail(`images[${JSON.stringify(source)}] must be { type: string, data: Uint8Array }`);
    out[source] = image as unknown as ImageBytes;
  }
  return out;
}

// Validates a compile request and fills the spec's defaults (tala, root board, worker budgets). Throws ProtocolError with the first problem.
export function normalizeCompileRequest(input: unknown): NormalizedRequest {
  if (!isObject(input)) return fail('request must be an object');
  if (input.v !== PROTOCOL_VERSION) fail(`unsupported protocol version ${String(input.v)}`);
  if (input.type !== 'compile') fail(`unexpected message type ${String(input.type)}`);
  const { files, entry, layout } = input;
  filesAndEntry(files, entry);
  if (layout !== undefined && !ENGINES.includes(layout as Engine)) fail(`unknown layout engine ${String(layout)}`);
  return {
    v: PROTOCOL_VERSION, type: 'compile', id: integer(input.id, 'id', 0), revision: integer(input.revision, 'revision', 0),
    files: files as Record<string, string>, entry: entry as string, layout: (layout as Engine | undefined) ?? 'tala', seeds: seeds(input.seeds),
    render: render(input.render), budgets: overlay(DEFAULT_BUDGETS, input.budgets as Budgets | undefined, 'budgets'), boards: boards(input.boards),
    ...(input.images === undefined ? {} : { images: images(input.images) }),
  };
}

const MAX_OPS = 256;

// Spec 0012: validates an edit request; the worker refuses what d2oracle refuses, this only checks the shape.
export function normalizeEditRequest(input: unknown): EditRequest {
  if (!isObject(input)) return fail('request must be an object');
  if (input.v !== PROTOCOL_VERSION) fail(`unsupported protocol version ${String(input.v)}`);
  if (input.type !== 'edit') fail(`unexpected message type ${String(input.type)}`);
  const { files, entry, board = '', ops } = input;
  filesAndEntry(files, entry);
  if (typeof board !== 'string') fail('board must be a compile result path');
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > MAX_OPS) fail(`ops must hold 1 to ${MAX_OPS} operations`);
  (ops as unknown[]).forEach((op, i) => {
    const bad = (what: string) => fail(`ops[${i}]: ${what}`);
    if (!isObject(op) || typeof op.key !== 'string') return bad('needs a string key');
    if (op.op === 'set') { if (op.value !== null && typeof op.value !== 'string') bad('set needs a string or null value'); if (op.tag !== undefined && typeof op.tag !== 'string') bad('tag must be a string'); }
    else if (op.op === 'rename') { if (typeof op.name !== 'string') bad('rename needs a string name'); }
    else if (op.op === 'move') { if (typeof op.parent !== 'string') bad('move needs a string parent ("" for the root)'); }
    else if (op.op === 'row' || op.op === 'row-delete' || op.op === 'row-rename') {
      if (typeof op.name !== 'string' || !op.name) bad('row needs a non-empty string name');
      if (op.op === 'row-rename' && (typeof op.to !== 'string' || !op.to)) bad('row-rename needs a non-empty string to');
      if (op.op === 'row') {
        if (op.type !== undefined && typeof op.type !== 'string') bad('type must be a string');
        if (op.constraint !== undefined && op.constraint !== null && typeof op.constraint !== 'string' && !(Array.isArray(op.constraint) && op.constraint.every(c => typeof c === 'string'))) bad('constraint must be null, a string or a string list');
      }
    }
    else if (op.op === 'reorder') { if (op.before !== undefined && (typeof op.before !== 'string' || !op.before)) bad('before must be a non-empty string'); }
    else if (op.op === 'reconnect') {
      for (const end of ['src', 'dst']) if (op[end] !== undefined && (typeof op[end] !== 'string' || !op[end])) bad(`${end} must be a non-empty string`);
      if (op.reverse !== undefined && typeof op.reverse !== 'boolean') bad('reverse must be a boolean');
    }
    else if (op.op !== 'create' && op.op !== 'delete' && op.op !== 'unset') bad(`unknown operation ${String(op.op)}`);
  });
  return {
    v: PROTOCOL_VERSION, type: 'edit', id: integer(input.id, 'id', 0), revision: integer(input.revision, 'revision', 0),
    files: files as Record<string, string>, entry: entry as string, board: board as string, ops: ops as EditOp[],
  };
}
