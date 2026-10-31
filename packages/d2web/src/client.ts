import { PROTOCOL_VERSION, SCENE_VERSION, type CompileRequest, type CompileResult, type WorkerMessage, type WorkerReady } from './protocol.ts';
import { normalizeCompileRequest } from './request.ts';

// Minimal Worker surface so tests can script one; a real `Worker` fits.
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerMessage }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export interface ClientOptions {
  spawn: () => WorkerLike;
  // A running compile older than this is aborted (terminate and respawn) when a newer request arrives; otherwise the newer one waits.
  supersedeAfterMs?: number;
  // Counted from when the request is posted: no reply for this long and the worker is replaced; the request fails with TimeoutError.
  silentTimeoutMs?: number;
  // A worker that never sends `ready` within this time is replaced the same way.
  startupTimeoutMs?: number;
}

export type CompileInput = Omit<CompileRequest, 'v' | 'type' | 'id'>;

export class SupersededError extends Error {}
// `code: 'budget'` marks a compile aborted by budgets.maxLayoutMillis (spec 0008); other timeouts have no code.
export class TimeoutError extends Error { code?: 'budget'; }
// The worker's wasm speaks another protocol or scene version than this client (usually a stale cached wasm; spec 0003 section 4).
export class VersionError extends Error {}

interface Job { request: CompileRequest; resolve: (r: CompileResult) => void; reject: (e: unknown) => void; started: number; timer?: ReturnType<typeof setTimeout> }

// Spec 0001 section 3.4: one compile at a time, latest request wins, no cooperative cancel (abort = terminate and respawn).
export function createClient({ spawn, supersedeAfterMs = 2000, silentTimeoutMs = 120_000, startupTimeoutMs = 30_000 }: ClientOptions) {
  let worker: WorkerLike;
  let ready: Promise<WorkerReady>;
  let running: Job | null = null;
  let waiting: Job | null = null;
  let nextId = 0;
  let disposed = false;

  function start() {
    const mine = (worker = spawn());
    ready = new Promise(resolve => {
      mine.onmessage = ({ data }) => {
        if (mine !== worker) return;
        if (data.type === 'ready') resolve(data);
        else if (running && data.type === 'result' && data.id === running.request.id) finish(data);
      };
    });
    mine.onerror = event => { if (mine === worker) abort(new Error(event.message ?? 'worker error')); };
  }

  function settle(job: Job) { clearTimeout(job.timer); running = null; }

  function finish(result: CompileResult) {
    const job = running!;
    settle(job);
    if (waiting) job.reject(new SupersededError(`revision ${job.request.revision} was superseded`));
    else job.resolve(result);
    pump();
  }

  // Replace the worker and fail the running compile.
  function abort(error: unknown) {
    const job = running;
    worker.terminate();
    start();
    if (job) { settle(job); job.reject(error); }
    pump();
  }

  function pump() {
    if (running || !waiting || disposed) return;
    const job = (running = waiting);
    waiting = null;
    job.started = Date.now();
    const timeout = (ms: number, what: string, code?: 'budget') => setTimeout(() => { if (running === job) abort(Object.assign(new TimeoutError(`${what} for ${ms} ms`), { code })); }, ms);
    job.timer = timeout(startupTimeoutMs, 'worker not ready');
    const mine = worker;
    ready.then(hello => {
      if (running !== job || mine !== worker) return;
      clearTimeout(job.timer);
      if (hello.v !== PROTOCOL_VERSION || hello.sceneVersion !== SCENE_VERSION) {
        settle(job);
        job.reject(new VersionError(`worker speaks protocol ${hello.v}, scene ${hello.sceneVersion}; client expects ${PROTOCOL_VERSION}, ${SCENE_VERSION}`));
        return pump();
      }
      const budget = job.request.budgets!.maxLayoutMillis!;
      job.timer = budget <= silentTimeoutMs ? timeout(budget, 'compile exceeded budgets.maxLayoutMillis', 'budget') : timeout(silentTimeoutMs, 'no reply');
      mine.postMessage(job.request);
    });
  }

  start();
  return {
    compile(input: CompileInput): Promise<CompileResult> {
      if (disposed) return Promise.reject(new Error('client is disposed'));
      let request: CompileRequest;
      try { request = normalizeCompileRequest({ v: PROTOCOL_VERSION, type: 'compile', id: nextId++, ...input }); } catch (error) { return Promise.reject(error); }
      return new Promise((resolve, reject) => {
        waiting?.reject(new SupersededError(`revision ${waiting.request.revision} was superseded`));
        waiting = { request, resolve, reject, started: 0 };
        if (running && Date.now() - running.started > supersedeAfterMs) abort(new SupersededError(`revision ${running.request.revision} was aborted`));
        else pump();
      });
    },
    dispose() {
      disposed = true;
      worker.terminate();
      for (const job of [running, waiting]) { if (job) { clearTimeout(job.timer); job.reject(new Error('client is disposed')); } }
      running = waiting = null;
    },
  };
}

export interface SpawnWorkerOptions {
  // Override any URL (same-origin only for `worker`); defaults resolve next to this module.
  worker?: string | URL;
  exec?: string | URL;
  wasm?: string | URL;
}

// A `spawn` for createClient (spec 0003 section 3). `new URL(..., import.meta.url)` is the form bundlers recognise as an asset.
export function spawnWorker({ worker = new URL('./worker.js', import.meta.url), exec, wasm }: SpawnWorkerOptions = {}): () => WorkerLike {
  return () => {
    const url = new URL(worker, location.href);
    if (exec) url.searchParams.set('exec', new URL(exec, location.href).href);
    if (wasm) url.searchParams.set('wasm', new URL(wasm, location.href).href);
    return new Worker(url) as WorkerLike;
  };
}
