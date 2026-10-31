// Classic Web Worker hosting the D2 wasm (spec 0001). Started as `new Worker('worker.js?exec=<wasm_exec.js URL>&wasm=<d2web.wasm URL>')`.
// Posts the ready message once, then answers each compile request with a result object.
const params = new URL(self.location.href).searchParams;
importScripts(params.get('exec'));
(async () => {
  const go = new Go();
  go.argv = ['d2web', '--serve'];
  go.run(await WebAssembly.instantiate(await WebAssembly.compileStreaming(fetch(params.get('wasm'))), go.importObject));
  while (!self.d2webReady) await new Promise(resolve => setTimeout(resolve, 2));
  onmessage = async event => postMessage(JSON.parse(await self.d2webCompile(JSON.stringify(event.data))));
  postMessage(JSON.parse(self.d2webReady));
})();
