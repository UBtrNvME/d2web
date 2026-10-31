import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Consumer: React owns the card content; the sizing loop owns each wrapper's box. Research code, not a library.
const BASE = 'direction: right\na.label: ""\nb.label: ""\nc.label: ""\nd.label: ""\na -> b\nb -> c\nb -> d\n';
const NODES = { a: ['Alpha', 'Entry'], b: ['Revenue', 'Quarterly revenue'], c: ['Churn', 'Monthly'], d: ['Notes', 'Free text'] };
const stats = { renders: 0, compiles: 0, observed: 0, steps: [] };
window.stats = stats;
window.measuredSizes = () => JSON.parse(JSON.stringify(window.sizes ?? {}));

function Content({ title, body }) {
  return (<><CardHeader className="px-4"><CardTitle>{title}</CardTitle></CardHeader><CardContent className="px-4 text-sm text-muted-foreground">{body}</CardContent></>);
}

function NodeCard({ id, title, body, boxes, sizes }) {
  const measure = useRef(null);
  useLayoutEffect(() => {
    const el = measure.current;
    const read = () => { const r = el.getBoundingClientRect(); sizes.current[id] = [Math.ceil(r.width), Math.ceil(r.height)]; };
    read();
    const ro = new ResizeObserver(() => { read(); stats.observed++; window.requestRelayout(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [id]);
  const box = boxes[id];
  stats.renders++;
  return (
    <>
      {/* hidden natural-size copy: measured and observed; the visible card fills D2's box */}
      <div ref={measure} aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', width: 'max-content', maxWidth: 260, pointerEvents: 'none' }}><Card className="gap-2 py-3"><Content title={title} body={body} /></Card></div>
      <div data-node={id} style={{ position: 'absolute', left: box?.X ?? 0, top: box?.Y ?? 0, width: box?.Width, height: box?.Height, visibility: box ? 'visible' : 'hidden' }}><Card className="h-full gap-2 py-3"><Content title={title} body={body} /></Card></div>
    </>
  );
}

function App() {
  const [text, setText] = useState(Object.fromEntries(Object.entries(NODES).map(([id, [title, body]]) => [id, { title, body }])));
  const [layout, setLayout] = useState(null);
  const sizes = useRef({});
  window.sizes = sizes.current;
  const pending = useRef(false);
  window.setBody = (id, body) => setText(t => ({ ...t, [id]: { ...t[id], body } }));
  window.requestRelayout = () => { pending.current = true; schedule(); };
  const running = useRef(false);
  const schedule = async () => {
    if (running.current) return;
    running.current = true;
    while (pending.current) {
      pending.current = false;
      const request = BASE + Object.entries(sizes.current).map(([id, [w, h]]) => `${id}.width: ${w}\n${id}.height: ${h}\n`).join('');
      const t0 = performance.now();
      const result = JSON.parse(await d2compile(request));
      stats.compiles++;
      stats.steps.push(Math.round(performance.now() - t0));
      if (!result.error) setLayout(result);
    }
    running.current = false;
    window.idle = (window.idle ?? 0) + 1;
  };
  useEffect(() => { window.requestRelayout(); }, []);
  const boxes = layout?.nodes ?? {};
  window.layoutState = layout;
  return (
    <div style={{ position: 'relative', width: 900, height: 500 }}>
      <svg width="900" height="500" style={{ position: 'absolute', inset: 0 }}>{(layout?.edges ?? []).map(e => <polyline key={e.id} data-edge={e.id} fill="none" stroke="#7b2cbf" strokeWidth="2" points={e.route.map(p => p.join(',')).join(' ')} />)}</svg>
      {Object.entries(text).map(([id, t]) => <NodeCard key={id} id={id} title={t.title} body={t.body} boxes={boxes} sizes={sizes} />)}
    </div>
  );
}

const wasm = await WebAssembly.compileStreaming(fetch('/loop-serve.wasm'));
const go = new Go();
go.argv = ['loop', '--serve'];
go.run(await WebAssembly.instantiate(wasm, go.importObject));
while (!globalThis.d2compile) await new Promise(r => setTimeout(r, 5));
createRoot(document.getElementById('app')).render(<App />);
window.ready = true;
