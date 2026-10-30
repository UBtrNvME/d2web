import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { pathData, root } from './examples.mjs';

// Disposable JointJS Core probe; package files and generated output stay ignored.
const output = join(root, 'artifacts/research-jointjs');
if (process.argv.includes('--setup')) {
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'package.json'), JSON.stringify({
    name: 'd2web-jointjs-research', private: true, type: 'module', packageManager: 'pnpm@12.14.0',
    dependencies: { '@joint/core': '4.3.4' },
  }, null, 2) + '\n');
  const install = spawnSync('pnpm', ['--dir', output, '--ignore-workspace', 'install', '--ignore-scripts', '--config.auto-install-peers=false'],
    { cwd: root, stdio: 'inherit' });
  assert.ifError(install.error);
  assert.equal(install.status, 0, 'Disposable JointJS install failed');
  process.exit(0);
}

const packageDirectory = join(output, 'node_modules/@joint/core');
const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
assert.equal(manifest.version, '4.3.4');
assert.equal(manifest.license, 'MPL-2.0');
const native = JSON.parse(await readFile(join(root, 'artifacts/scene-probe/native.json'), 'utf8'));
assert.deepEqual(native.target.shapes.map(shape => shape.id), ['source', 'target']);
const connection = native.target.connections[0];
const primitive = native.webScene.Root.Children.find(node => node.ID === connection.id).Children[0].Primitive;
assert(primitive.Commands.every(command => [0, 1].includes(command.Kind)), 'Only the existing straight-route fixture is admitted');
const path = pathData(primitive.Commands);
const fixture = { shapes: native.target.shapes, connection, path };
await writeFile(join(output, 'input.json'), JSON.stringify(fixture, null, 2) + '\n');
await writeFile(join(output, 'package-evidence.json'), JSON.stringify({
  name: manifest.name, version: manifest.version, license: manifest.license,
  dependencies: manifest.dependencies,
  registry: 'https://registry.npmjs.org/@joint%2fcore/4.3.4',
  install: 'Scratch package under ignored artifacts; workspace ignored, scripts disabled, auto peers disabled.',
  lockLimit: 'The scratch lockfile is ignored and removed by clean; regenerate only for a new explicitly recorded run.',
}, null, 2) + '\n');
const entry = `import { dia, g, shapes } from '@joint/core';
const fixture = ${JSON.stringify(fixture)};
window.fixture = fixture;
window.observations = { clicks: [], paperEvents: 0 };
const markup = [
  { tagName: 'rect', selector: 'body' },
  { tagName: 'foreignObject', selector: 'content', children: [{
    tagName: 'div', namespaceURI: 'http://www.w3.org/1999/xhtml', selector: 'html',
    children: [{ tagName: 'button', selector: 'button', textContent: 'Open node' }],
  }] },
];
const Node = dia.Element.define('d2web.Node', {
  attrs: {
    body: { width: 'calc(w)', height: 'calc(h)', fill: '#dceeff', stroke: '#234', strokeWidth: 1 },
    content: { x: 2, y: 2, width: 'calc(w-4)', height: 'calc(h-4)' },
  },
}, { markup });
const graph = new dia.Graph();
const elements = fixture.shapes.map(shape => new Node({
  id: shape.id, type: 'd2web.Node', position: shape.pos, size: { width: shape.width, height: shape.height },
  attrs: { button: { event: 'click', cursor: 'pointer' } },
}));
const connector = () => new g.Path(fixture.path);
const link = new shapes.standard.Link({
  id: fixture.connection.id,
  source: { id: fixture.connection.src }, target: { id: fixture.connection.dst },
  router: () => [], connector,
  attrs: { line: { stroke: fixture.connection.stroke, strokeWidth: fixture.connection.strokeWidth,
    targetMarker: { type: 'path', d: 'M 0 -4 8 0 0 4 z' } } },
});
graph.addCells([...elements, link]);
const paper = new dia.Paper({
  el: document.getElementById('paper'), model: graph, width: 600, height: 240,
  async: false, interactive: false, cellNamespace: { ...shapes, d2web: { Node } }, cellViewNamespace: { ...shapes, d2web: { Node } },
  preventDefaultViewAction: true,
});
paper.on('cell:pointerdown', () => window.observations.paperEvents++);
paper.el.addEventListener('click', event => {
  if (event.target.closest('button')) window.observations.clicks.push(event.target.closest('button').textContent);
});
window.probeReady = true;
window.disposeProbe = () => { paper.remove(); graph.clear(); return { cells: graph.getCells().length, paperAttached: paper.el.isConnected }; };
`;
await writeFile(join(output, 'entry.js'), entry);
await build({ entryPoints: [join(output, 'entry.js')], outfile: join(output, 'probe.js'), bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', alias: { '@joint/core': packageDirectory } });
await writeFile(join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>JointJS native bounds probe</title>
<style>body{margin:0}#paper{width:600px;height:240px}.joint-paper{overflow:visible}#paper rect{fill:rgb(1,2,3)!important;stroke-width:7px!important}
g[data-type="d2web.Node"]{user-select:text;-webkit-user-select:text}foreignObject div{width:100%;height:100%;box-sizing:border-box}
button{font:8px/12px Arial;padding:0}</style><div id="paper"></div><script type="module" src="./probe.js"></script></html>`);
console.log(JSON.stringify({ output, version: manifest.version, license: manifest.license, path }));
