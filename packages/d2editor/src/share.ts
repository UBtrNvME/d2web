// D2's URL encoding (lib/urlenc, as the playground's `?script=`): raw deflate with no dictionary, then padded base64url. Links work both ways.
// A link can come from anyone, so decoding stops at a size limit instead of inflating whatever it is given.
export const MAX_SCRIPT_BYTES = 2_000_000;

export async function encodeScript(text: string): Promise<string> {
  const bytes = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_');
}

export async function decodeScript(encoded: string, limit = MAX_SCRIPT_BYTES): Promise<string> {
  const bytes = Uint8Array.from(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let size = 0, text = '';
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    size += r.value.length;
    if (size > limit) { await reader.cancel(); throw new Error(`the linked diagram is larger than ${limit} bytes`); }
    text += utf8.decode(r.value, { stream: true });
  }
  return text + utf8.decode();
}
