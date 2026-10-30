import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { root } from './examples.mjs';

const output = join(root, 'artifacts/research-host');
const studio = join(root, 'imports/d2-architecture-studio');
const scene = JSON.parse(await readFile(join(root, 'artifacts/scene-probe/geometry.json'), 'utf8'));
const source = scene.Root.Children.find(node => node.ID === 'source').Children[0].Primitive.Box;
const edge = scene.Root.Children.find(node => node.ID === '(source -> target)[0]').Children[0].Primitive.Commands;
const path = edge.map(command => `${command.Kind === 0 ? 'M' : 'L'}${command.P1.X} ${command.P1.Y}`).join(' ');
assert(edge.every(command => [0, 1].includes(command.Kind)), 'Fixture must remain a straight line');
await mkdir(output, { recursive: true });
await writeFile(join(output, 'native.js'), `const box=${JSON.stringify(source)}, path=${JSON.stringify(path)};
export function mount(host) {
  const owned=document.createElement('div');
  owned.className='native-scene'; owned.dataset.d2Id=host.id;
  owned.style.cssText='position:relative;width:260px;height:100px';
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 260 100'); svg.setAttribute('width','260'); svg.setAttribute('height','100');
  const route=document.createElementNS(svg.namespaceURI,'path');
  route.setAttribute('d',path);route.setAttribute('fill','none');route.setAttribute('stroke','#7b2cbf');route.setAttribute('stroke-width','4');
  svg.append(route);
  const slot=document.createElement('div');
  slot.dataset.slot=''; slot.style.cssText='position:absolute;left:'+box.X+'px;top:'+box.Y+'px;width:'+box.Width+'px;height:'+box.Height+'px';
  owned.append(svg,slot); host.append(owned);
  const click=()=>{window.nativeActions.push(host.id);host.dispatchEvent(new CustomEvent('host-action',{detail:host.id}));};
  owned.addEventListener('click',click);
  return {slot,dispose(){owned.removeEventListener('click',click);owned.remove();}};
}
`);
const entry = `import React, {StrictMode,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {Card,CardContent} from '@/components/ui/card';
import {mount} from './native.js';
window.actions=[]; window.nativeActions=[];
function Host({id}) {
 const [slot,setSlot]=useState(null);
 useEffect(()=>{const handle=mount(document.getElementById(id));const record=e=>window.actions.push(id+':'+e.detail);
 document.getElementById(id).addEventListener('host-action',record);setSlot(handle.slot);
 return ()=>{document.getElementById(id).removeEventListener('host-action',record);handle.dispose();};},[id]);
 return slot&&createPortal(<Card data-card={id} style={{height:'100%',boxSizing:'border-box',padding:'4px',border:'1px solid',background:'white'}}>
  <CardContent style={{padding:0}}><button data-host-button={id} type="button">Open {id}</button></CardContent>
 </Card>,slot);
}
const a=createRoot(document.getElementById('a')), b=createRoot(document.getElementById('b'));
window.unmountA=()=>a.unmount();
a.render(<StrictMode><Host id="a"/></StrictMode>); b.render(<StrictMode><Host id="b"/></StrictMode>);
`;
await writeFile(join(output, 'entry.jsx'), entry);
await build({entryPoints:[join(output,'entry.jsx')],outfile:join(output,'probe.js'),bundle:true,format:'esm',platform:'browser',jsx:'automatic',target:'es2022',
 alias:{react:join(root,'node_modules/react'), 'react-dom':join(root,'node_modules/react-dom'), '@':studio}});
await writeFile(join(output,'index.html'), `<!doctype html><meta charset="utf-8"><style>body{margin:0}.host{position:relative;width:260px;height:100px;display:inline-block;margin:20px}</style><div id="root"><div id="a" class="host"></div><div id="b" class="host"></div></div><script type="module" src="./probe.js"></script>`);
console.log(JSON.stringify({output, path, actualCard:join(studio,'components/ui/card.tsx')}));
