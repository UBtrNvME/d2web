// Classic Web Worker hosting the D2 wasm (spec 0001). `exec` and `wasm` query parameters override the default URLs next to this file (spec 0003 section 3).
// Posts the ready message once, then answers each compile request with a result object.
const params = new URL(self.location.href).searchParams;
importScripts(params.get('exec') ?? new URL('wasm_exec.js', self.location.href).href);
(async () => {
  const go = new Go();
  go.argv = ['d2web', '--serve'];
  const response = await fetch(params.get('wasm') ?? new URL('d2web.wasm', self.location.href).href);
  // compileStreaming needs Content-Type: application/wasm; a host that gets it wrong is slower, not broken.
  const module = response.headers.get('content-type')?.startsWith('application/wasm') ? await WebAssembly.compileStreaming(response) : await WebAssembly.compile(await response.arrayBuffer());
  go.run(await WebAssembly.instantiate(module, go.importObject));
  while (!self.d2webReady) await new Promise(resolve => setTimeout(resolve, 2));
  onmessage = async event => postMessage(JSON.parse(await self.d2webCompile(JSON.stringify(event.data))));
  postMessage(JSON.parse(self.d2webReady));
})();
