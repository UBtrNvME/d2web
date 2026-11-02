import { createImageResolver, normalizeImages, type ImagesOption } from './images.ts';
import { PROTOCOL_VERSION, SCENE_VERSION, type CompileRequest, type CompileResult, type FontSpec, type FontsMessage, type ImageBytes, type PreflightResult, type WorkerMessage, type WorkerReady } from './protocol.ts';
import { normalizeCompileRequest, normalizeFonts } from './request.ts';

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
  // Spec 0007: fallback fonts the consumer approves (ADR 0006). Fetched once, on the first compile, checked against `sha256` when given, then handed to
  // every worker before its first compile. Nothing outside this list is ever fetched.
  fonts?: FontSpec[];
  // D2's own Noto Color Emoji file, for colour emoji (docs/upstream/d2fonts-wasm-supply-bundled-emoji.patch; only a patched build accepts it). Same fetch and
  // checksum rules as `fonts`; D2 also checks the bytes against its pinned hash, so any other file is refused.
  emoji?: FontSpec;
  // The fetch used for `fonts` (default: the page's); a hook for tests and consumers that cache elsewhere.
  fetch?: (url: string) => Promise<Response>;
  // Spec 0010: how image links are handled. Absent: nothing is fetched and a remote image is D2's placeholder. 'bundle': the page resolves each link to bytes
  // (consumer's `resolve`/`supplied`) before the compile and the worker paints them; 'link': the link is kept and the browser loads it.
  images?: ImagesOption;
}

export type CompileInput = Omit<CompileRequest, 'v' | 'type' | 'id' | 'images' | 'linkImages'>;

export class SupersededError extends Error {}
// `code: 'budget'` marks a compile aborted by budgets.maxLayoutMillis (spec 0008); other timeouts have no code.
export class TimeoutError extends Error { code?: 'budget'; }
// The worker's wasm speaks another protocol or scene version than this client (usually a stale cached wasm; spec 0003 section 4).
export class VersionError extends Error {}
// A listed font could not be fetched, did not match its checksum, or the wasm refused it (spec 0007).
export class FontError extends Error {}

interface Job {
  request: CompileRequest; resolve: (r: CompileResult) => void; reject: (e: unknown) => void; started: number; timer?: ReturnType<typeof setTimeout>;
  // Set while the page is resolving images (spec 0010): aborting it cancels the `resolve` calls; `preflight` receives the worker's list of links.
  imagePhase?: { controller: AbortController; preflight?: (r: PreflightResult) => void };
}

// Spec 0001 section 3.4: one compile at a time, latest request wins, no cooperative cancel (abort = terminate and respawn).
export function createClient({ spawn, supersedeAfterMs = 2000, silentTimeoutMs = 120_000, startupTimeoutMs = 30_000, fonts, emoji, fetch: fetchFont = u => fetch(u), images }: ClientOptions) {
  const imageOption = images === undefined ? undefined : normalizeImages(images);
  const resolveImages = imageOption?.mode === 'bundle' ? createImageResolver(imageOption) : undefined;
  const listed = fonts === undefined ? undefined : normalizeFonts(fonts);
  const emojiSpec = emoji === undefined ? undefined : normalizeFonts([emoji])[0];
  let fontBytes: Promise<FontsMessage> | undefined;
  const sent = new WeakSet<object>();
  const fetchBytes = async (f: FontSpec) => {
    const response = await fetchFont(f.url).catch(e => { throw new FontError(`font ${f.name}: ${(e as Error).message}`); });
    if (!response.ok) throw new FontError(`font ${f.name}: ${f.url} answered ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    if (f.sha256) {
      const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (hex !== f.sha256) throw new FontError(`font ${f.name}: checksum mismatch (got ${hex})`);
    }
    return data;
  };
  const loadFonts = () => (fontBytes ??= Promise.all([
    Promise.all((listed ?? []).map(async f => ({ name: f.name, data: await fetchBytes(f) }))),
    emojiSpec ? fetchBytes(emojiSpec) : undefined,
  ]).then(([list, emojiData]) => ({ type: 'fonts' as const, fonts: list, ...(emojiData ? { emoji: emojiData } : {}) })));
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
        else if (data.type === 'fonts') { if (data.error && running) { const job = running; settle(job); job.reject(new FontError(`worker refused the fonts: ${data.error}`)); pump(); } }
        else if (data.type === 'images') { if (running && data.id === running.request.id) running.imagePhase?.preflight?.(data); }
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
    ready.then(async hello => {
      if (running !== job || mine !== worker) return;
      clearTimeout(job.timer);
      if (hello.v !== PROTOCOL_VERSION || hello.sceneVersion !== SCENE_VERSION) {
        settle(job);
        job.reject(new VersionError(`worker speaks protocol ${hello.v}, scene ${hello.sceneVersion}; client expects ${PROTOCOL_VERSION}, ${SCENE_VERSION}`));
        return pump();
      }
      const budget = job.request.budgets!.maxLayoutMillis!;
      if ((listed?.length || emojiSpec) && !sent.has(mine)) {
        job.timer = timeout(silentTimeoutMs, 'fonts not loaded');
        try { mine.postMessage(await loadFonts()); sent.add(mine); clearTimeout(job.timer); } catch (error) { if (running === job) { settle(job); job.reject(error); pump(); } return; }
        if (running !== job || mine !== worker) return;
      }
      let request = job.request;
      if (imageOption?.mode === 'link') request = { ...request, linkImages: true };
      if (resolveImages) {
        job.timer = timeout(silentTimeoutMs, 'images not resolved');
        const images = await prepareImages(job, mine, resolveImages);
        if (running !== job || mine !== worker) return;
        clearTimeout(job.timer);
        request = { ...request, images, ...(imageOption?.mode === 'bundle' && imageOption.fallback ? { linkImages: true } : {}) };
      }
      job.timer = budget <= silentTimeoutMs ? timeout(budget, 'compile exceeded budgets.maxLayoutMillis', 'budget') : timeout(silentTimeoutMs, 'no reply');
      mine.postMessage(request);
    });
  }

  // Spec 0010 section 2.2: ask the worker which links the boards use, resolve them on the page, and hand the bytes to the compile. Every failure leaves a link
  // unresolved (the worker warns and paints the placeholder); none fails the compile. Returns undefined when the job was superseded meanwhile.
  async function prepareImages(job: Job, mine: WorkerLike, resolveLinks: ReturnType<typeof createImageResolver>): Promise<Record<string, ImageBytes> | undefined> {
    const phase: NonNullable<Job['imagePhase']> = (job.imagePhase = { controller: new AbortController() });
    try {
      const { files, entry, boards = [''] } = job.request;
      // Without the word "icon" in any file there is no image to ask about (a `shape: image` needs one too): no round trip. The worker still warns about any it finds.
      if (!Object.values(files).some(text => /icon/i.test(text))) return {};
      const listed = await new Promise<PreflightResult>(resolve => {
        phase.preflight = resolve;
        mine.postMessage({ v: PROTOCOL_VERSION, type: 'preflight', id: job.request.id, files, entry });
        phase.controller.signal.addEventListener('abort', () => resolve({ v: PROTOCOL_VERSION, type: 'images', id: job.request.id, links: [], error: 'aborted' }));
      });
      if (listed.error) return {};
      const wanted = listed.links.filter(l => boards === 'all' || boards.includes(l.board));
      return await resolveLinks(wanted, phase.controller.signal);
    } finally {
      if (job.imagePhase === phase) job.imagePhase = undefined;
    }
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
        else if (running?.imagePhase) { // still resolving images: nothing was compiled, so cancel the `resolve` calls and move on without a respawn
          const job = running;
          job.imagePhase!.controller.abort();
          settle(job);
          job.reject(new SupersededError(`revision ${job.request.revision} was superseded`));
          pump();
        } else pump();
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
