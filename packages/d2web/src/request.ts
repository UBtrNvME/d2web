import { PROTOCOL_VERSION, type Budgets, type CompileRequest, type Engine, type RenderOptions } from './protocol.ts';

const ENGINES: readonly Engine[] = ['tala', 'dagre', 'elk'];

// Path of the root board in a compile result (the census keys the root board by the empty path).
export const ROOT_BOARD = '';

// shortcut: placeholder ceilings copied from the research probes (research/census.go); replace with measured defaults when the worker exists.
export const DEFAULT_BUDGETS = {
  maxNodes: 100_000,
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
  budgets: ResolvedBudgets;
  boards: string[] | 'all';
}

export class ProtocolError extends Error {}

const fail = (message: string): never => { throw new ProtocolError(message); };
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

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

// Validates a compile request and fills the spec's defaults (tala, root board, worker budgets). Throws ProtocolError with the first problem.
export function normalizeCompileRequest(input: unknown): NormalizedRequest {
  if (!isObject(input)) return fail('request must be an object');
  if (input.v !== PROTOCOL_VERSION) fail(`unsupported protocol version ${String(input.v)}`);
  if (input.type !== 'compile') fail(`unexpected message type ${String(input.type)}`);
  const { files, entry, layout } = input;
  if (!isObject(files) || !Object.values(files).every(f => typeof f === 'string')) fail('files must map paths to text');
  if (typeof entry !== 'string' || !Object.hasOwn(files as object, entry)) fail('entry must name one of the files');
  if (layout !== undefined && !ENGINES.includes(layout as Engine)) fail(`unknown layout engine ${String(layout)}`);
  return {
    v: PROTOCOL_VERSION, type: 'compile', id: integer(input.id, 'id', 0), revision: integer(input.revision, 'revision', 0),
    files: files as Record<string, string>, entry: entry as string, layout: (layout as Engine | undefined) ?? 'tala',
    render: render(input.render), budgets: overlay(DEFAULT_BUDGETS, input.budgets as Budgets | undefined, 'budgets'), boards: boards(input.boards),
  };
}
