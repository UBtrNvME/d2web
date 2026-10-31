import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { nativeArgs, pathData, root } from '../tests/examples.mjs';

const output = join(root, 'artifacts/research-consumer');
const studio = join(root, 'imports/d2-architecture-studio');
const run = (cmd, args, cwd = root) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); return r.stdout;
};
for (const name of ['package', 'consumer/node_modules/d2web-native-probe', 'native', 'web']) mkdirSync(join(output, name), { recursive: true });
const base = JSON.parse(readFileSync(join(root, 'artifacts/scene-probe/native.json'), 'utf8'));
const resizedInput = readFileSync(join(root, 'examples/research/sizing/main.d2'), 'utf8');
const resized = JSON.parse(run(join(root, 'artifacts/scene-probe/scene-probe'), [resizedInput]));
writeFileSync(join(output, 'resized.json'), JSON.stringify(resized));
assert.equal(resized.target.shapes.find(s => s.id === 'source').width, 160);
assert.notDeepEqual(resized.target.connections[0].route, base.target.connections[0].route);
const manifest = { name: 'd2web-native-probe', version: '0.0.0', type: 'module', packageManager: 'pnpm@12.14.0', exports: './index.js', files: ['index.js'], sideEffects: false };
writeFileSync(join(output, 'package/package.json'), JSON.stringify(manifest));
// Experimental package has no framework, CSS, source rewriting or ambient application state.
writeFileSync(join(output, 'package/index.js'), `export function mount(host, {onAction = () => {}} = {}) {
 const node=document.createElement('div'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 const path=document.createElementNS(svg.namespaceURI,'path'),slot=document.createElement('div');
 node.style.position='relative';svg.setAttribute('width','500');svg.setAttribute('height','180');
 path.setAttribute('fill','none');path.setAttribute('stroke','#7b2cbf');path.setAttribute('stroke-width','4');svg.append(path);
 slot.dataset.nativeSlot='';slot.style.position='absolute';node.append(svg,slot);host.append(node);
 const click=()=>onAction();node.addEventListener('click',click);
 return {slot,update({box,path:route}) {
   if(!box||![box.X,box.Y,box.Width,box.Height].every(Number.isFinite)||box.Width<=0||box.Height<=0||typeof route!=='string'||!route.startsWith('M'))throw Error('Invalid geometry');
   path.setAttribute('d',route);Object.assign(slot.style,{left:box.X+'px',top:box.Y+'px',width:box.Width+'px',height:box.Height+'px'});
 },dispose(){node.removeEventListener('click',click);node.remove();}};
}
`);
run('pnpm', ['--dir', join(output, 'package'), '--ignore-workspace', 'pack', '--out', join(output, 'probe.tgz')]);
run('tar', ['-xzf', join(output, 'probe.tgz'), '-C', join(output, 'consumer/node_modules/d2web-native-probe'), '--strip-components', '1']);
writeFileSync(join(output, 'consumer/package.json'), JSON.stringify({ private: true, type: 'module', packageManager: 'pnpm@12.14.0' }));
run('node', ['--input-type=module', '-e', "const m=await import('d2web-native-probe');if(typeof m.mount!=='function'||typeof document!=='undefined')throw Error('Import failed');"], join(output, 'consumer'));
const geometry = data => {
  const group = data.webScene.Root.Children.find(n => n.ID === data.target.connections[0].id);
  return { box: data.webScene.Root.Children.find(n => n.ID === 'source').Children[0].Primitive.Box,
    path: pathData(group.Children[0].Primitive.Commands) };
};
writeFileSync(join(output, 'base.json'), JSON.stringify(geometry(base)));
const entry = `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{createPortal}from'react-dom';
import{mount}from'd2web-native-probe';import{Card,CardContent}from'@/components/ui/card';
const initial=${JSON.stringify(geometry(base))};window.geometry=initial;window.events=0;
const handle=mount(document.getElementById('surface'),{onAction:()=>window.events++});handle.update(initial);window.handle=handle;
window.resizeCard=async()=>{const card=document.querySelector('[data-card]');card.style.width='160px';card.style.height='80px';
const r=card.getBoundingClientRect();const response=await fetch('/compile-size',{method:'POST',body:JSON.stringify({width:r.width,height:r.height})});
if(!response.ok)throw Error(await response.text());const next=await response.json();handle.update(next);window.geometry=next;};
function App(){const[n,setN]=useState(0);return createPortal(<Card data-card="" className="h-full gap-0 p-1"><CardContent className="p-0"><button onClick={()=>setN(n+1)}>Card {n}</button></CardContent></Card>,handle.slot)}
createRoot(document.getElementById('react')).render(<App/>);
`;
writeFileSync(join(output, 'consumer/entry.jsx'), entry);
await build({ entryPoints: [join(output, 'consumer/entry.jsx')], outfile: join(output, 'probe.js'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', alias: { react: join(root, 'node_modules/react'), 'react-dom': join(root, 'node_modules/react-dom'), '@': studio } });
const req = createRequire(realpathSync(join(studio, 'node_modules/@tailwindcss/postcss/package.json')));
const postcss = req('postcss');
const tailwind = (await import(pathToFileURL(req.resolve('@tailwindcss/postcss')))).default;
const css = `@import "tailwindcss" source(none);
@source "${join(studio, 'components/ui/card.tsx')}";
@source "${join(output, 'consumer/entry.jsx')}";
@theme inline { --color-card: var(--card); --color-card-foreground: var(--card-foreground); --radius-xl: calc(var(--radius) + 4px); }
:root{--card:rgb(240,245,250);--card-foreground:rgb(10,20,30);--radius:8px;--border:rgb(100,110,120)}
.dark{--card:rgb(20,30,40);--card-foreground:rgb(230,240,250);--radius:12px;--border:rgb(150,160,170)}
[data-card]{border-color:var(--border)}
`;
const compiled = await postcss([tailwind()]).process(css, { from: join(studio, 'research-only.css') });
writeFileSync(join(output, 'theme.css'), compiled.css);
writeFileSync(join(output, 'index.html'), '<!doctype html><link rel="stylesheet" href="/theme.css"><div id="surface"></div><div id="react"></div><script type="module" src="/probe.js"></script>');
for (const [name, data] of [['base', base], ['resized', resized]]) {
  const n = join(output, 'native', name), w = join(output, 'web', name);
  mkdirSync(n, { recursive: true }); mkdirSync(w, { recursive: true });
  if (name === 'base') copyFileSync(join(root, 'artifacts/scene-probe/native.svg'), join(n, 'diagram.svg'));
  else run('d2', [...nativeArgs, join(root, 'examples/research/sizing/main.d2'), join(n, 'diagram.svg')]);
  writeFileSync(join(n, 'case.json'), JSON.stringify({status:0, source:name==='base'?'examples/files/geometry.d2':'examples/research/sizing/main.d2'}));
  writeFileSync(join(w, 'geometry.json'), JSON.stringify(data.webScene));
  copyFileSync(join(root, 'artifacts/scene-probe/react.js'), join(w, 'react.js'));
  writeFileSync(join(w, 'diagram.html'), '<!doctype html><body style="margin:0"><div id="root"></div><script type="module" src="./react.js"></script>');
}
writeFileSync(join(output, 'evidence.json'), JSON.stringify({ package:manifest, geometryBase:geometry(base), geometryResized:geometry(resized), tailwindVersion:JSON.parse(readFileSync(join(studio,'node_modules/@tailwindcss/postcss/package.json'),'utf8')).version, note:'Experimental packed native module, consumer-owned real Card/Tailwind CSS, explicit native compile via test transport; not a released SDK or browser-WASM sizing API.' }, null, 2));
console.log('Packed native module imports without DOM/React; consumer theme and two real parity scenes built.');
