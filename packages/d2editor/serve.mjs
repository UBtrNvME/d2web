// Serves packages/d2editor/dist on loopback: `mise run editor`. Not part of the site.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.wasm': 'application/wasm', '.txt': 'text/plain' };
const port = Number(process.env.PORT ?? 5281);

createServer(async (req, res) => {
  const name = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'index.html';
  if (name.includes('..')) { res.writeHead(400).end(); return; }
  try {
    res.writeHead(200, { 'content-type': types[extname(name)] ?? 'application/octet-stream' }).end(await readFile(join(dist, name)));
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`d2editor on http://127.0.0.1:${port}`));
