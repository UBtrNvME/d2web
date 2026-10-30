import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { root } from './examples.mjs';

// Disposable adapter probe; React Flow and its lockfile live only in ignored artifacts.
const output = join(root, 'artifacts/research-reactflow');
if (process.argv.includes('--setup')) {
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'package.json'), JSON.stringify({
    name:'d2web-reactflow-research', private:true, type:'module', packageManager:'pnpm@12.14.0',
    dependencies:{'@xyflow/react':'12.12.0'},
  }, null, 2) + '\n');
  const install = spawnSync('pnpm', ['--dir', output, '--ignore-workspace', 'install', '--ignore-scripts', '--config.auto-install-peers=false'],
    {cwd:root, stdio:'inherit'});
  assert.ifError(install.error);
  assert.equal(install.status, 0, 'Disposable React Flow install failed');
  process.exit(0);
}
const packageDirectory = join(output, 'node_modules/@xyflow/react');
const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
assert.equal(manifest.version, '12.12.0');
assert.equal(manifest.license, 'MIT');
const native = JSON.parse(await readFile(join(root, 'artifacts/scene-probe/native.json'), 'utf8'));
assert.deepEqual(native.target.shapes.map(shape => shape.id), ['source', 'target']);
const connection = native.target.connections[0];
const primitive = native.webScene.Root.Children.find(node => node.ID === connection.id).Children[0].Primitive;
assert(primitive.Commands.every(command => [0, 1].includes(command.Kind)), 'Only the existing straight-route fixture is admitted');
const path = primitive.Commands.map(command => `${command.Kind === 0 ? 'M' : 'L'}${command.P1.X} ${command.P1.Y}`).join(' ');
const fixture = { shapes: native.target.shapes, connection, path };
await mkdir(output, { recursive: true });
await writeFile(join(output, 'input.json'), JSON.stringify(fixture, null, 2) + '\n');
await writeFile(join(output, 'package-evidence.json'), JSON.stringify({
  name: manifest.name, version: manifest.version, license: manifest.license,
  dependencies: manifest.dependencies, peerDependencies: manifest.peerDependencies,
  registry: 'https://registry.npmjs.org/@xyflow%2freact/12.12.0',
  reactResolution: 'Root react/react-dom shared through esbuild aliases; fixture peer auto-install disabled',
  lockLimit: 'The scratch lockfile is ignored and removed by clean; regenerating it can select newer allowed transitive versions. Preserve it with reports for exact repetition.',
}, null, 2) + '\n');
const entry = `import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Handle, Position, BaseEdge } from '@xyflow/react';
import '@xyflow/react/dist/base.css';
const fixture = ${JSON.stringify(fixture)};
window.fixture = fixture;
window.observations = { nodeChanges: [], edgeChanges: [], viewportChanges: [], clicks: [], edgeProps: null };
function ConsumerNode({ id, data }) {
  return <div data-d2-id={id} className="consumer-card" style={{background: data.fill}}>
    <span className="selectable nodrag nopan">Select</span>
    <button type="button" className="nodrag nopan" onClick={() => window.observations.clicks.push(id)}>Open {id}</button>
    <Handle id="in" type="target" position={Position.Left} style={{visibility:'hidden'}} />
    <Handle id="out" type="source" position={Position.Right} style={{visibility:'hidden'}} />
  </div>;
}
function NativeEdge(props) {
  window.observations.edgeProps = { sourceX: props.sourceX, sourceY: props.sourceY, targetX: props.targetX, targetY: props.targetY };
  return <BaseEdge id={props.id} path={props.data.path} style={{stroke: fixture.connection.stroke, strokeWidth: fixture.connection.strokeWidth}} />;
}
const nodeTypes = { consumer: ConsumerNode }, edgeTypes = { native: NativeEdge };
const nodes = fixture.shapes.map(shape => ({ id: shape.id, type: 'consumer', position: shape.pos,
  style: {width: shape.width, height: shape.height}, initialWidth: shape.width, initialHeight: shape.height,
  data: shape, draggable: false, connectable: false, deletable: false }));
const edges = [{id:fixture.connection.id, source:fixture.connection.src, target:fixture.connection.dst,
  sourceHandle:'out', targetHandle:'in', type:'native', data:{path:fixture.path}, deletable:false}];
const root = createRoot(document.getElementById('root'));
let revision = 0;
window.renderProbe = (zoom = 1) => root.render(<ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
  viewport={{x:30,y:30,zoom}} minZoom={0.25} maxZoom={4} fitView={false}
  nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} elementsSelectable={false}
  panOnDrag={false} panOnScroll={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
  autoPanOnNodeDrag={false} autoPanOnConnect={false} autoPanOnNodeFocus={false}
  selectionOnDrag={false} deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
  onNodesChange={changes => window.observations.nodeChanges.push(...changes)}
  onEdgesChange={changes => window.observations.edgeChanges.push(...changes)}
  onViewportChange={viewport => window.observations.viewportChanges.push(viewport)}
  onInit={() => { window.probeReady = true; }}>
  <span data-revision={++revision} />
</ReactFlow>);
window.renderProbe();
`;
await writeFile(join(output, 'entry.jsx'), entry);
await build({ entryPoints: [join(output, 'entry.jsx')], outfile: join(output, 'probe.js'), bundle: true,
  format: 'esm', platform: 'browser', jsx: 'automatic', target: 'es2022',
  alias: { react: join(root, 'node_modules/react'), 'react-dom': join(root, 'node_modules/react-dom'), '@xyflow/react': packageDirectory },
});
await writeFile(join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>React Flow native route probe</title>
<link rel="stylesheet" href="./probe.css"><style>
body { margin: 0; } #root { width: 600px; height: 240px; }
/* Viewer flags remove wrapper pointer events; consumer controls explicitly opt back in. */
.consumer-card { width:100%; height:100%; box-sizing:border-box; padding:2px; font:8px/12px Arial; pointer-events:auto; }
.selectable { display:block; user-select:text; }
.consumer-card button { display:block; max-width:100%; font:8px/10px Arial; padding:0; }
</style><div id="root"></div><script type="module" src="./probe.js"></script></html>`);
console.log(JSON.stringify({ output, version: manifest.version, license: manifest.license, path }));
