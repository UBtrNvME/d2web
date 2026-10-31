// Serves packages/d2web/dist plus this demo page on loopback: `mise run demo`. Not part of the package.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '../dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.txt': 'text/plain' };
const port = Number(process.env.PORT ?? 5280);

createServer(async (req, res) => {
  const name = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'index.html';
  if (name.includes('..')) { res.writeHead(400).end(); return; }
  for (const dir of name === 'index.html' ? [here] : [dist]) {
    try {
      const body = await readFile(join(dir, name));
      res.writeHead(200, { 'content-type': types[extname(name)] ?? 'application/octet-stream' }).end(body);
      return;
    } catch { /* try the next directory */ }
  }
  res.writeHead(404).end('not found');
}).listen(port, '127.0.0.1', () => console.log(`d2web demo on http://127.0.0.1:${port}`));
