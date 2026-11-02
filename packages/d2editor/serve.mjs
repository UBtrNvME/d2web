// Serves packages/d2editor/dist on loopback: `mise run editor`. Not part of the site.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.wasm': 'application/wasm', '.txt': 'text/plain' };
const port = Number(process.env.PORT ?? 5281);

export async function serve(req, res) {
  const name = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'index.html';
  if (name.includes('..')) { res.writeHead(400).end(); return; }
  try {
    const body = await readFile(join(dist, name));
    res.writeHead(200, { 'content-type': types[extname(name)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // localhost may resolve to either loopback address, including for requests inside a worker.
  for (const host of ['127.0.0.1', '::1']) createServer(serve).listen(port, host, () => console.log(`d2editor on http://${host === '::1' ? '[::1]' : host}:${port}`));
}
