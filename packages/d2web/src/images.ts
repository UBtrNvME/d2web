import type { ImageBytes, ImageLink } from './protocol.ts';
import { isObject, ProtocolError } from './request.ts';

// Spec 0010. The page resolves image links to bytes; the worker never fetches. Nothing here runs unless the consumer passes `images`.

export type ImageSource = Blob | ArrayBuffer | Uint8Array;
export interface ImageLimits { bytes?: number; count?: number; timeoutMs?: number; concurrency?: number }
export type ImageResolve = (source: string, context: { signal: AbortSignal }) => Promise<ImageSource | null>;

export type ImagesOption =
  | {
      mode: 'bundle';
      resolve: ImageResolve;
      // Known bytes by link, tried before `resolve`.
      supplied?: Record<string, ImageSource>;
      // Links that stay unresolved are shown as links (spec 0010 section 2.3) instead of the placeholder.
      fallback?: 'link';
      limits?: ImageLimits;
    }
  | { mode: 'link' };

// Defaults of spec 0010 section 2.5.
export const DEFAULT_IMAGE_LIMITS = { bytes: 4 << 20, count: 256, timeoutMs: 15_000, concurrency: 6 } as const;
// The worker's cumulative ceiling (compile/images.go); the cache stays under it too.
const CUMULATIVE_BYTES = 32 << 20;
const NEGATIVE_TTL_MS = 60_000;

export function normalizeImages(value: unknown): ImagesOption {
  if (!isObject(value)) throw new ProtocolError('images must be an object');
  if (value.mode === 'link') {
    for (const key of Object.keys(value)) if (key !== 'mode') throw new ProtocolError(`unknown images.${key} for mode 'link'`);
    return { mode: 'link' };
  }
  if (value.mode !== 'bundle') throw new ProtocolError("images.mode must be 'bundle' or 'link'");
  for (const key of Object.keys(value)) if (!['mode', 'resolve', 'supplied', 'fallback', 'limits'].includes(key)) throw new ProtocolError(`unknown images.${key}`);
  if (typeof value.resolve !== 'function') throw new ProtocolError("images.resolve must be a function in mode 'bundle'");
  if (value.fallback !== undefined && value.fallback !== 'link') throw new ProtocolError("images.fallback must be 'link'");
  if (value.supplied !== undefined) {
    if (!isObject(value.supplied)) throw new ProtocolError('images.supplied must map links to bytes');
    for (const [link, bytes] of Object.entries(value.supplied)) if (!isImageSource(bytes)) throw new ProtocolError(`images.supplied[${JSON.stringify(link)}] must be a Blob, ArrayBuffer or Uint8Array`);
  }
  if (value.limits !== undefined) {
    if (!isObject(value.limits)) throw new ProtocolError('images.limits must be an object');
    for (const [key, n] of Object.entries(value.limits)) {
      if (!(key in DEFAULT_IMAGE_LIMITS)) throw new ProtocolError(`unknown images.limits.${key}`);
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new ProtocolError(`images.limits.${key} must be an integer >= 1`);
    }
  }
  return value as unknown as ImagesOption;
}

const isImageSource = (v: unknown): v is ImageSource => v instanceof Uint8Array || v instanceof ArrayBuffer || (typeof Blob !== 'undefined' && v instanceof Blob);

async function toBytes(value: unknown, type = ''): Promise<ImageBytes | null> {
  if (value instanceof Uint8Array) return { type, data: value };
  if (value instanceof ArrayBuffer) return { type, data: new Uint8Array(value) };
  if (typeof Blob !== 'undefined' && value instanceof Blob) return { type: value.type || type, data: new Uint8Array(await value.arrayBuffer()) };
  return null;
}

// What the resolver and the worker's transport treat as the same request: the link without its #fragment.
export const withoutFragment = (link: string) => link.split('#')[0];

// A fetch-based `resolve` for the common case (spec 0010 2.1). Never the default: the consumer names the origins. Links outside `allow`, non-2xx
// answers, network failures and aborts resolve to null (an unresolved image); it never throws.
export function fetchImages({ allow, credentials = 'omit', fetch: doFetch = (...args) => fetch(...args) }: {
  allow: string[];
  credentials?: 'omit' | 'same-origin' | 'include';
  fetch?: typeof fetch;
}): ImageResolve {
  if (!Array.isArray(allow) || !allow.every(o => typeof o === 'string')) throw new ProtocolError('fetchImages: allow must be an array of origins');
  const origins = new Set(allow.map(o => { try { return new URL(o).origin; } catch { throw new ProtocolError(`fetchImages: ${JSON.stringify(o)} is not an origin`); } }));
  return async (source, { signal }) => {
    try {
      const url = new URL(source);
      if (!origins.has(url.origin)) return null;
      const response = await doFetch(url.href, { credentials, signal, referrerPolicy: 'no-referrer' });
      return response.ok ? await response.blob() : null;
    } catch {
      return null;
    }
  };
}

// Resolves the links of one compile. Keeps a bounded cache so a later compile with the same links makes no `resolve` call.
export function createImageResolver(option: Extract<ImagesOption, { mode: 'bundle' }>) {
  const limits = { ...DEFAULT_IMAGE_LIMITS, ...option.limits };
  const cache = new Map<string, { value: ImageBytes | null; at: number }>();
  let cached = 0;
  const remember = (key: string, value: ImageBytes | null) => {
    cache.delete(key);
    cache.set(key, { value, at: Date.now() });
    cached += value?.data.length ?? 0;
    for (const [k, v] of cache) { // oldest first
      if (cache.size <= limits.count && cached <= CUMULATIVE_BYTES) break;
      cache.delete(k); cached -= v.value?.data.length ?? 0;
    }
  };

  // Resolves each distinct link once (fragment ignored) and returns bytes for every spelling of it that came back. `signal` aborts the whole batch.
  return async function resolveLinks(links: Pick<ImageLink, 'source'>[], signal: AbortSignal): Promise<Record<string, ImageBytes>> {
    const spellings = new Map<string, string[]>();
    for (const { source } of links) {
      if (source.startsWith('data:')) continue; // never fetched: the builder reads data URIs itself
      const key = withoutFragment(source);
      const list = spellings.get(key) ?? [];
      if (!list.includes(source)) list.push(source);
      spellings.set(key, list);
    }
    const found = new Map<string, ImageBytes | null>();
    const todo: string[] = [];
    for (const key of [...spellings.keys()].slice(0, limits.count)) {
      const hit = cache.get(key);
      if (hit && (hit.value || Date.now() - hit.at < NEGATIVE_TTL_MS)) found.set(key, hit.value);
      else todo.push(key);
    }
    const supplied = option.supplied ?? {};
    const one = async (key: string): Promise<ImageBytes | null> => {
      const first = spellings.get(key)![0];
      const given = [first, ...spellings.get(key)!, key].map(s => supplied[s]).find(v => v !== undefined);
      if (given !== undefined) { const v = await toBytes(given); return v && v.data.length > 0 && v.data.length <= limits.bytes ? v : null; }
      return new Promise<ImageBytes | null>(done => {
        const own = new AbortController();
        const stop = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); own.abort(); };
        const finish = (value: ImageBytes | null) => { stop(); done(value && value.data.length > 0 && value.data.length <= limits.bytes ? value : null); };
        const onAbort = () => finish(null);
        const timer = setTimeout(() => finish(null), limits.timeoutMs);
        if (signal.aborted) return finish(null);
        signal.addEventListener('abort', onAbort);
        Promise.resolve().then(() => option.resolve(first, { signal: own.signal })).then(v => toBytes(v), () => null).then(finish, () => finish(null));
      });
    };
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limits.concurrency, todo.length) }, async () => {
      while (next < todo.length && !signal.aborted) {
        const key = todo[next++];
        const value = await one(key);
        if (!signal.aborted) { found.set(key, value); remember(key, value); }
      }
    }));
    const out: Record<string, ImageBytes> = {};
    for (const [key, value] of found) if (value) for (const spelling of spellings.get(key)!) out[spelling] = value;
    return out;
  };
}
