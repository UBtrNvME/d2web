// Classic Web Worker hosting the D2 wasm (spec 0001). `exec` and `wasm` query parameters override the default URLs next to this file (spec 0003 section 3).
// Posts the ready message once, then answers each compile request with a result object.
const params = new URL(self.location.href).searchParams;
importScripts(params.get('exec') ?? new URL('wasm_exec.js', self.location.href).href);
// A browser has no files. wasm_exec.js answers every file-system call with ENOSYS ("not implemented"), which D2 reports as a failed compile; ENOENT ("no such
// file") is the truth, and D2's image resolver turns it into the placeholder (spec 0010: a relative image path is a link the page supplies, or an unresolved one).
for (const name of ['stat', 'lstat']) globalThis.fs[name] = (path, callback) => callback(Object.assign(new Error('no such file or directory'), { code: 'ENOENT' }));
globalThis.fs.open = (path, flags, mode, callback) => callback(Object.assign(new Error('no such file or directory'), { code: 'ENOENT' }));
// Image bytes cross the JSON boundary as base64 (Go decodes []byte from it); everything else in the request is already JSON.
const base64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(text); };
const withImagesEncoded = request => {
  if (!request.images) return request;
  const images = {};
  for (const [source, image] of Object.entries(request.images)) images[source] = { type: image.type, data: base64(image.data) };
  return { ...request, images };
};
(async () => {
  const go = new Go();
  go.argv = ['d2web', '--serve'];
  const response = await fetch(params.get('wasm') ?? new URL('d2web.wasm', self.location.href).href);
  // compileStreaming needs Content-Type: application/wasm; a host that gets it wrong is slower, not broken.
  const module = response.headers.get('content-type')?.startsWith('application/wasm') ? await WebAssembly.compileStreaming(response) : await WebAssembly.compile(await response.arrayBuffer());
  go.run(await WebAssembly.instantiate(module, go.importObject));
  while (!self.d2webReady) await new Promise(resolve => setTimeout(resolve, 2));
  onmessage = async event => {
    // Spec 0007: the client posts the consumer's fallback fonts once per worker, before the first compile.
    if (event.data.type === 'fonts') {
      const error = self.d2webSetFonts(event.data.fonts.map(f => f.name), event.data.fonts.map(f => f.data)) || (event.data.emoji ? self.d2webSetEmoji(event.data.emoji) : '');
      return postMessage({ type: 'fonts', error });
    }
    // Spec 0010: which image links does this source use? Compiled without layout, so it is cheap.
    if (event.data.type === 'preflight') return postMessage(JSON.parse(self.d2webPreflight(JSON.stringify(event.data))));
    // Spec 0012: an edit runs no layout, so it is synchronous like the preflight.
    if (event.data.type === 'edit') return postMessage(JSON.parse(self.d2webEdit(JSON.stringify(event.data))));
    postMessage(JSON.parse(await self.d2webCompile(JSON.stringify(withImagesEncoded(event.data)))));
  };
  postMessage(JSON.parse(self.d2webReady));
})();
