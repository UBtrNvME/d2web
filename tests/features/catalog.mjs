// The D2 feature catalog (feature-map plan, step 1): every construct the pinned D2 source defines, with a minimal D2 case and the way
// it reaches the web. `covers` names source-derived IDs (see source.mjs); catalog.test.mjs fails when the pinned source has an ID no entry
// covers, so a D2 upgrade cannot silently add features the map does not know.
//
// mechanism: how the web sees the feature
//   compile-only  D2 resolves it while compiling (variables, classes, globs, imports...); the web only receives the result
//   scene-paint   it arrives as scene primitives the painter must draw
//   interaction   it needs browser behaviour beyond paint (links, tooltips)
const entries = [];
const add = (family, name, covers, source, extra = {}) => entries.push({ id: `${family}/${name}`, family, covers, source, mechanism: 'scene-paint', ...extra });

// ---- shapes -------------------------------------------------------------------------------------------------------------------------
const remoteIcon = 'https://icons.terrastruct.com/essentials%2F092-graph%20bar.svg';
// Offline fixture: the worker never fetches (compile.go), so icons are inlined to compare the same bytes on both sides.
const icon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="8" y="30" width="12" height="26" fill="#2b6cb0"/><rect x="26" y="14" width="12" height="42" fill="#c05621"/><rect x="44" y="22" width="12" height="34" fill="#2f855a"/></svg>')}`;
const shapeSource = {
  sql_table: 'x: {shape: sql_table; id: int {constraint: primary_key}; name: varchar(100) {constraint: unique}}',
  class: 'x: {shape: class; +field: int; -secret: string; +method(a: int): string}',
  code: 'x: |`go\nfunc main() {\n  println("hi")\n}\n`|',
  image: `x: {shape: image; icon: ${icon}}`,
  sequence_diagram: 'x: {shape: sequence_diagram; a -> b: hello; b -> a: ok}',
  hierarchy: 'x: {shape: hierarchy; root: {lhs; rhs}}',
  text: 'x: plain text {shape: text}',
  square: 'x: Hi {shape: square}',
  circle: 'x: Hi {shape: circle}',
};
const shapes = ['rectangle', 'square', 'page', 'parallelogram', 'document', 'cylinder', 'queue', 'package', 'step', 'callout', 'stored_data', 'person', 'c4-person', 'diamond', 'oval', 'circle', 'hexagon', 'cloud', 'text', 'code', 'class', 'sql_table', 'image', 'sequence_diagram', 'hierarchy'];
for (const s of shapes) add('shape', s, [`shape:${s}`, 'keyword:shape'], shapeSource[s] ?? `x: Hi {shape: ${s}}`);

// ---- styles ---------------------------------------------------------------------------------------------------------------------------
const styles = [
  ['opacity', ['0.4']], ['stroke', ['"#ff0000"']], ['fill', ['"#ffe0e0"']], ['stroke-width', ['6']], ['stroke-dash', ['5']], ['border-radius', ['12']],
  ['font', ['mono']], ['font-size', ['28']], ['font-color', ['"#0000ff"']], ['bold', ['true', 'false']], ['italic', ['true']], ['underline', ['true']],
  ['shadow', ['true']], ['multiple', ['true']], ['double-border', ['true']], ['3d', ['true']],
];
for (const [key, values] of styles) for (const v of values) add('style', `${key}=${v.replaceAll('"', '')}`, [`style:${key}`, 'keyword:style'], `x: Hi {style.${key}: ${v}}\ny: There\nx -> y`);
for (const p of ['none', 'dots', 'lines', 'grain', 'paper']) add('style', `fill-pattern=${p}`, [`style:fill-pattern`, `pattern:${p}`], `x: Hi {style.fill: "#cfe8ff"; style.fill-pattern: ${p}}`);
for (const t of ['none', 'uppercase', 'lowercase', 'capitalize']) add('style', `text-transform=${t}`, ['style:text-transform', `transform:${t}`], `x: Mixed Case {style.text-transform: ${t}}`);
add('style', 'animated', ['style:animated'], 'a -> b {style.animated: true}');
add('style', 'filled', ['style:filled'], 'a -> b {target-arrowhead: {shape: diamond; style.filled: true}}');
add('style', 'edge-stroke-and-width', ['style:stroke', 'style:stroke-width', 'style:stroke-dash', 'style:opacity'], 'a -> b {style: {stroke: "#cc0000"; stroke-width: 4; stroke-dash: 3; opacity: 0.6}}');
add('style', 'edge-label-font', ['style:font-size', 'style:font-color', 'style:bold'], 'a -> b: label {style: {font-size: 20; font-color: "#0033aa"; bold: true}}');

// ---- connections and arrowheads -------------------------------------------------------------------------------------------------------------
const arrowheads = ['none', 'arrow', 'unfilled-triangle', 'triangle', 'diamond', 'filled-diamond', 'circle', 'filled-circle', 'cross', 'box', 'filled-box', 'line', 'cf-one', 'cf-many', 'cf-one-required', 'cf-many-required'];
// D2 source spells filled variants as a base shape plus `style.filled`; `line` exists only in the renderers (no source produces it in v0.9.0).
const spelling = { 'unfilled-triangle': 'triangle; style.filled: false', 'filled-diamond': 'diamond; style.filled: true', 'filled-circle': 'circle; style.filled: true', 'filled-box': 'box; style.filled: true' };
for (const a of arrowheads) {
  const shape = spelling[a] ?? a;
  add('arrowhead', a, [`arrow:${a}`, 'keyword:target-arrowhead', ...(shape.includes('filled') ? ['style:filled'] : [])], a === 'line' ? 'a -> b' : `a -> b: {target-arrowhead: {shape: ${shape}}}`, a === 'line' ? { unreachable: true } : {});
}
add('arrowhead', 'source-and-target', ['keyword:source-arrowhead', 'keyword:target-arrowhead'], 'a <-> b: {source-arrowhead.shape: diamond; target-arrowhead.shape: circle}');
add('arrowhead', 'labels', ['keyword:source-arrowhead', 'keyword:target-arrowhead', 'extra:arrowhead-label'], 'a -> b: {source-arrowhead.label: 1; target-arrowhead.label: "*"}');
add('connection', 'directed', ['extra:edge'], 'a -> b');
add('connection', 'reverse', ['extra:edge'], 'a <- b');
add('connection', 'both', ['extra:edge'], 'a <-> b');
add('connection', 'undirected', ['extra:edge'], 'a -- b');
add('connection', 'label', ['extra:edge', 'keyword:label'], 'a -> b: hello there');
add('connection', 'chain', ['extra:edge'], 'a -> b -> c -> d');
add('connection', 'parallel', ['extra:edge'], 'a -> b: one\na -> b: two\nb -> a: back');
add('connection', 'self-loop', ['extra:edge'], 'a -> a: loop');
add('connection', 'nested-endpoints', ['extra:edge'], 'g: {a; b}\nh: {c}\ng.a -> h.c: across\ng -> h');
add('connection', 'indexed-style', ['extra:edge', 'style:stroke'], 'a -> b\na -> b\n(a -> b)[1].style.stroke: "#cc0000"', { mechanism: 'compile-only' });
add('container', 'nesting', ['extra:container'], 'outer: Outer {\n  middle: Middle {\n    inner: Inner\n  }\n  side\n}');
add('container', 'label-outside', ['extra:container', 'keyword:label'], 'g: Group {a; b; c}');

// ---- label and icon positions, near, tooltip positions -------------------------------------------------------------------------------------------
const positions = ['top-left', 'top-center', 'top-right', 'center-left', 'center-center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right',
  'outside-top-left', 'outside-top-center', 'outside-top-right', 'outside-left-top', 'outside-left-center', 'outside-left-bottom', 'outside-right-top', 'outside-right-center', 'outside-right-bottom',
  'outside-bottom-left', 'outside-bottom-center', 'outside-bottom-right', 'border-top-left', 'border-top-center', 'border-top-right', 'border-left-top', 'border-left-center', 'border-left-bottom',
  'border-right-top', 'border-right-center', 'border-right-bottom', 'border-bottom-left', 'border-bottom-center', 'border-bottom-right'];
for (const p of positions) {
  add('label-position', p, [`labelpos:${p}`, 'keyword:near', 'keyword:label'], `x: {width: 300; height: 200; label: Label; label.near: ${p}}`);
  add('icon-position', p, [`labelpos:${p}`, 'keyword:icon', 'keyword:near'], `x: {width: 300; height: 200; icon: ${icon}; icon.near: ${p}}`);
}
for (const p of ['top-left', 'top-center', 'top-right', 'center-left', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right']) {
  add('near', p, [`near:${p}`, 'keyword:near'], `title: Title {near: ${p}}\na -> b`);
  add('tooltip', p, [`tooltippos:${p}`, 'keyword:tooltip', 'keyword:near'], `x: Hover me {tooltip: Tip text; tooltip.near: ${p}}`, { mechanism: 'interaction' });
}
add('near', 'object', ['keyword:near'], 'a\nb {near: a}');

// ---- layout ---------------------------------------------------------------------------------------------------------------------------------
for (const d of ['up', 'down', 'left', 'right']) add('direction', d, ['keyword:direction'], `direction: ${d}\na -> b -> c`);
add('direction', 'per-container', ['keyword:direction'], 'direction: down\ng: {direction: right; a -> b -> c}\ng -> h');
for (const layout of ['tala', 'dagre', 'elk']) add('layout-engine', layout, [`layout:${layout}`], 'a -> b -> c\na -> d\nd -> c\ng: {x; y; x -> y}', { layout });
add('grid', 'rows', ['keyword:grid-rows'], 'grid-rows: 2\na; b; c; d');
add('grid', 'columns', ['keyword:grid-columns'], 'grid-columns: 3\na; b; c; d; e');
add('grid', 'rows-and-columns', ['keyword:grid-rows', 'keyword:grid-columns'], 'grid-rows: 2\ngrid-columns: 2\na; b; c; d');
add('grid', 'gap', ['keyword:grid-gap', 'keyword:grid-columns'], 'grid-columns: 2\ngrid-gap: 40\na; b; c; d');
add('grid', 'vertical-and-horizontal-gap', ['keyword:vertical-gap', 'keyword:horizontal-gap', 'keyword:grid-columns'], 'grid-columns: 2\nvertical-gap: 10\nhorizontal-gap: 50\na; b; c; d');
add('grid', 'nested', ['keyword:grid-rows', 'keyword:grid-columns'], 'grid-columns: 2\nlhs: {grid-rows: 2; a; b}\nrhs: {c}');
add('size', 'width-height', ['keyword:width', 'keyword:height'], 'x: Wide {width: 300; height: 80}\ny: Tall {width: 60; height: 200}');
add('size', 'top-left', ['keyword:top', 'keyword:left'], 'x: Fixed {top: 10; left: 20}\ny: Fixed too {top: 120; left: 220}');
add('sequence', 'basics', ['extra:sequence'], 'shape: sequence_diagram\nalice -> bob: hello\nbob -> alice: hi back\nalice -> alice: think');
add('sequence', 'spans-notes-groups', ['extra:sequence'], 'shape: sequence_diagram\na -> b.t1: start\nb.t1 -> c: work\nb."A note on b"\ngrp: {a -> b: inside}');

// ---- content --------------------------------------------------------------------------------------------------------------------------------
add('content', 'markdown', ['extra:markdown', 'keyword:label'], 'x: |md\n  # Title\n  - one\n  - **two** _three_\n  [link](https://example.test)\n|');
add('content', 'code', ['extra:code', 'keyword:label'], 'x: |`ts\nconst n: number = 1;\n// comment\n`|');
add('content', 'latex', ['extra:latex', 'keyword:label'], 'x: |`latex\n\\frac{a}{b} + \\sqrt{c}\n`|', { network: false });
add('content', 'multiline', ['keyword:label'], 'x: "line one\\nline two\\nline three"');
add('content', 'unicode', ['keyword:label', 'extra:unicode'], 'x: "日本語 العربية 😀 é"');
add('content', 'fonts-bold-italic', ['style:bold', 'style:italic', 'style:underline', 'style:font'], 'x: Text {style: {bold: true; italic: true; underline: true; font: mono}}');
add('content', 'icon', ['keyword:icon'], `x: Icon {icon: ${icon}}`);
add('content', 'icon-remote', ['keyword:icon'], `x: Icon {icon: ${remoteIcon}}`, { network: true });
add('content', 'link', ['keyword:link'], 'x: Click {link: https://example.test}', { mechanism: 'interaction' });
add('content', 'tooltip', ['keyword:tooltip'], 'x: Hover {tooltip: Some tip}', { mechanism: 'interaction' });
add('content', 'tooltip-markdown', ['keyword:tooltip'], 'x: Hover {tooltip: |md **bold** tip |}', { mechanism: 'interaction' });
add('content', 'constraint', ['keyword:constraint'], 'x: {shape: sql_table; a: int {constraint: [primary_key; foreign_key]}}');

// ---- compile-time language features ---------------------------------------------------------------------------------------------------------------
const compileOnly = (name, covers, source, extra = {}) => add('language', name, covers, source, { mechanism: 'compile-only', ...extra });
compileOnly('classes', ['keyword:classes', 'keyword:class'], 'classes: {box: {style.fill: "#fde"}}\nx: {class: box}\ny: {class: [box]}');
compileOnly('vars', ['keyword:vars'], 'vars: {name: World}\nx: "Hello ${name}"');
compileOnly('globs', ['extra:glob'], '*.style.fill: "#def"\na; b; c\n(* -> *)[*].style.stroke: "#c00"\na -> b');
compileOnly('substitutions-spread', ['keyword:vars'], 'vars: {base: {style.fill: "#fed"}}\nx: {...${base}}');
compileOnly('imports', ['extra:import'], '...@shared\nlocal -> imported', { files: { 'shared.d2': 'imported: Imported\nother\n' } });
compileOnly('import-value', ['extra:import'], 'x: @shared', { files: { 'shared.d2': 'inner: Inside\n' } });
compileOnly('comments-and-null', ['extra:comment'], '# comment\na; b\na -> b\nb: null\n');
compileOnly('edge-references', ['extra:edge'], 'a -> b\n(a -> b)[0].label: renamed');
for (const b of ['layers', 'scenarios', 'steps']) add('board', b, [`board:${b}`], `base: Base\n${b}: {\n  one: {x -> y}\n  two: {z}\n}`, { boards: 'all' });
add('board', 'scenario-override', ['board:scenarios'], 'a: A\nb: B\na -> b\nscenarios: { changed: { a.style.fill: "#fdd" } }', { boards: 'all' });
add('board', 'nested-boards', ['board:layers', 'board:scenarios'], 'a\nlayers: { x: { b\n scenarios: { y: { c } } } }', { boards: 'all' });

// ---- themes, sketch, configuration ---------------------------------------------------------------------------------------------------------------
const themeDemo = 'direction: right\napp: App {style.fill-pattern: dots}\ndb: DB {shape: cylinder}\nuser: User {shape: person}\ngroup: Group {a; b}\nuser -> app: uses\napp -> db: reads\napp -> group.a {style.animated: true}\nnote: |md **Note** |';
const themeIds = [0, 1, 3, 4, 5, 6, 7, 8, 100, 101, 102, 103, 104, 105, 200, 201, 300, 301, 302, 303];
for (const id of themeIds) add('theme', String(id), [`theme:${id}`], themeDemo, { render: { themeId: id } });
add('theme', 'overrides', ['config:theme-overrides'], 'a -> b', { render: { themeId: 0, themeOverrides: { N1: '#102030', B1: '#ff6600' } } });
add('sketch', 'demo', ['extra:sketch'], themeDemo, { render: { sketch: true } });
add('sketch', 'shapes', ['extra:sketch'], 'a: A {shape: cylinder}\nb: B {shape: cloud}\nc: C {shape: diamond}\na -> b -> c', { render: { sketch: true } });
add('render', 'pad-scale-center', ['extra:render-options'], 'a -> b', { render: { pad: 40, scale: 1.5, center: true } });
const config = (name, cfg) => add('config', name, [`config:${name}`], `vars: {d2-config: {${cfg}}}\na -> b -> c`, { mechanism: 'compile-only' });
config('sketch', 'sketch: true'); config('theme-id', 'theme-id: 4'); config('dark-theme-id', 'dark-theme-id: 200'); config('pad', 'pad: 40');
config('layout-engine', 'layout-engine: dagre'); config('center', 'center: true');
config('theme-overrides', 'theme-overrides: {B1: "#ff6600"}'); config('dark-theme-overrides', 'dark-theme-overrides: {B1: "#ff6600"}'); config('data', 'data: {k: v}');
add('animation', 'animated-shape', ['style:animated'], 'x: Lift {style.animated: true}');
add('animation', 'animated-edges', ['style:animated'], 'a -> b {style.animated: true}\nb -> c {style.animated: true; style.stroke-dash: 5}');

// ---- depth: the catalog above has one case per source-derived construct; these combine and stretch them (colour forms, tables, content, effects) ------------------------
const col = (name, source, extra = {}) => add('color', name, ['extra:color'], source, extra);
col('named', 'x: Hi {style.fill: red; style.stroke: navy; style.stroke-width: 4}');
col('hex3', 'x: Hi {style.fill: "#fa0"; style.stroke: "#036"}');
col('transparent-fill', 'x: Hi {style.fill: transparent; style.stroke-width: 3}');
col('linear-gradient-fill', 'x: Hi {style.fill: "linear-gradient(#ff8800, #0088ff)"}');
col('linear-gradient-angle', 'x: Hi {style.fill: "linear-gradient(45deg, #ff8800 0%, #ffffff 50%, #0088ff 100%)"}');
col('radial-gradient-fill', 'x: Hi {style.fill: "radial-gradient(#ffffff, #2b6cb0)"}');
col('gradient-stroke', 'x: Hi {style.stroke: "linear-gradient(#cc0000, #0000cc)"; style.stroke-width: 8; style.fill: "#ffffff"}');
col('gradient-container', 'g: Group {style.fill: "linear-gradient(#e0f0ff, #ffe0f0)"; a; b}');
col('gradient-edge', 'a -> b {style.stroke: "linear-gradient(#cc0000, #0000cc)"; style.stroke-width: 5}');
col('gradient-on-shapes', 'a: A {shape: cylinder; style.fill: "linear-gradient(#ffd, #fa0)"}\nb: B {shape: cloud; style.fill: "radial-gradient(#fff, #6a6)"}\nc: C {shape: person; style.fill: "linear-gradient(#cdf, #46a)"}');
const table = (name, source, extra = {}) => add('table', name, ['extra:table'], source, extra);
table('sql-constraints', 'users: {shape: sql_table; id: int {constraint: primary_key}; email: varchar(255) {constraint: [unique; not_null]}; org: int {constraint: foreign_key}; bio: text}');
table('sql-columns-edges', 'a: {shape: sql_table; id: int {constraint: primary_key}; b_id: int {constraint: foreign_key}}\nb: {shape: sql_table; id: int {constraint: primary_key}; name: text}\na.b_id -> b.id');
table('sql-in-container', 'db: Database {users: {shape: sql_table; id: int {constraint: primary_key}; name: text}; orders: {shape: sql_table; id: int; user_id: int}}\ndb.orders.user_id -> db.users.id');
table('sql-styled', 'x: {shape: sql_table; style.fill: "#fdf"; style.stroke: "#606"; style.font-size: 18; id: int; v: text}');
table('class-members', 'x: Shape {shape: class; +name: string; -size: int; "#id": uuid; +area(): float; -render(ctx: Canvas): void}');
table('class-edges', 'a: Base {shape: class; +id: int}\nb: Derived {shape: class; +extra: string}\nb -> a: extends {target-arrowhead.shape: triangle}');
const rich = (name, source, extra = {}) => add('content', name, ['extra:content-depth'], source, extra);
rich('code-python', 'x: |`python\ndef add(a, b):\n    return a + b  # sum\n`|');
rich('code-json', 'x: |`json\n{"a": [1, 2, {"b": null}], "c": "text"}\n`|');
rich('code-long-lines', 'x: |`go\nfunc veryLongFunctionName(argumentOne int, argumentTwo string) (result string, err error) { return }\n`|');
rich('markdown-rich', 'x: |md\n  ## Heading\n  1. first\n  2. second\n\n  > quoted `code`\n\n  plain **bold** *italic* ~~gone~~\n|');
rich('markdown-table', 'x: ||md\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n||');
rich('latex-aligned', 'x: |`latex\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n`|', { network: false });
rich('long-label-wrap', 'x: "A rather long label that should wrap inside a fixed width box when D2 measures it" {width: 160}');
rich('label-on-container-and-children', 'g: Group label {a: first; b: second; a -> b: link label}');
const fx = (name, source, extra = {}) => add('effects', name, ['extra:effects'], source, extra);
fx('3d-container', 'g: Group {style.3d: true; a; b}');
fx('multiple-cylinder', 'x: DB {shape: cylinder; style.multiple: true}');
fx('shadow-container', 'g: Group {style.shadow: true; a; b}');
fx('double-border-circle', 'x: Hi {shape: circle; style.double-border: true}');
fx('border-radius-shapes', 'a: A {style.border-radius: 20}\nb: B {shape: square; style.border-radius: 40}\nc: C {shape: page; style.border-radius: 10}');
fx('opacity-container', 'g: Group {style.opacity: 0.3; a; b; a -> b}');
fx('stroke-dash-edges', 'a -> b {style.stroke-dash: 3}\nb -> c {style.stroke-dash: 9; style.stroke-width: 4}');
fx('near-object-container', 'g: {a; b}\nnote: Note {near: g}');
fx('combined-style', 'x: Hi {style: {fill: "linear-gradient(#fff, #fcb)"; stroke: "#c33"; stroke-width: 5; stroke-dash: 4; shadow: true; border-radius: 16; opacity: 0.8; italic: true}}');

// ---- Unicode families: native D2 picks host fonts, so these are checked against D2's own advances and the consumer's fonts (spec 0007), not native pixels ------------------
const uni = (name, source) => add('unicode', name, ['extra:unicode'], source, { fonts: ['dejavu', 'mplus'] });
uni('hebrew', 'x: שלום עולם');
uni('arabic', 'x: مرحبا بالعالم');
uni('mixed-direction', 'x: abc שלום def 123 عربي end');
uni('japanese', 'x: あいう 漢字 かな');
uni('cyrillic-greek', 'x: Привет мир αβγ δ');
uni('accents', 'x: éñüçøåß ąęł ăîșț');
uni('emoji-outline', 'x: 😀 smile');
uni('rtl-in-container', 'g: מכולה {a: שלום; b: עולם; a -> b: חץ}');
uni('cjk-edge-label', 'a: 日本 -> b: 中文: ラベル');
uni('bold-italic-hebrew', 'x: שלום {style.bold: true; style.italic: true}');

export const catalog = entries;
