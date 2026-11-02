// Feature map step 6: D2 capabilities that are not "paint this scene". `scope` is a proposal for the user to decide (ADR 0007 owns v1 scope).
export const beyondPaint = [
  ['SVG export (`d2renderers/d2svg`)', 'Native D2 output; the reference every comparison uses.', 'out of v1 runtime', 'The runtime paints DOM from the scene. `paintScene` already returns an SVG string, so an export is possible later; not promised or tested as an export.'],
  ['PNG, PDF (`d2cli` raster, paged)', 'Rasterising or paging the SVG.', 'out of scope', 'A host page can screenshot or print what is mounted.'],
  ['Animated GIF/SVG export (`d2animate`)', 'Multi-board animation export; `--animate-interval`.', 'out of scope (v1)', 'Edge animation in a single board is a painter gap, listed in the animation family.'],
  ['ASCII and text export (`d2ascii`)', 'Plain-text diagram output.', 'out of scope', ''],
  ['Format (`d2format`, `d2 fmt`)', 'Canonical source formatting.', 'v2 / consumer tool', 'Linked into the same Go module; would need exposing from the wasm.'],
  ['Edit operations (`d2oracle`)', 'Programmatic source edits (rename, move, style, delete).', 'v2 editing (ADR 0004, 0007)', 'Research shows edits mutate the supplied AST on failure; a copy-on-write wrapper is the proposed approach.'],
  ['Language server (`d2lsp`)', 'Completions, hover, go-to-definition for editors.', 'v2 / consumer', 'The association payload (spec 0004) already supplies source ranges for read-only features.'],
  ['Watch, play, serve (`d2 --watch`, `d2 play`)', 'Developer tooling around the CLI.', 'out of scope', ''],
  ['D2 JS/wasm bridge (`d2js`)', 'D2\'s own browser entry point.', 'not used', 'd2web has its own worker and protocol (spec 0001).'],
  ['External layout plugins (`d2plugin` exec)', 'Out-of-process layout engines.', 'not possible in the browser', 'TALA, dagre and ELK are linked into the wasm.'],
  ['Custom fonts (`--font-regular` etc.)', 'Replace the bundled font families.', 'consumer-supplied fonts (ADR 0006)', 'Not wired into the request yet.'],
  ['Image embedding and remote fetch (`--bundle`, icons)', 'D2 fetches and inlines remote images.', 'consumer-chosen modes (ADR 0011, spec 0010)', 'The worker stays offline. By default an image is D2\'s placeholder; `images: { mode: \'bundle\' }` has the page supply the bytes (native\'s default SVG behaviour), `{ mode: \'link\' }` keeps the link as an image element (`--bundle=false`). Relative paths are links the page supplies; there is no file system.'],
  ['Seeds, timeouts, `--tala-seeds`', 'Layout search effort.', 'request field `seeds`, default 1, 2, 3 (the d2 CLI default)', 'Spec 0001: a consumer may ask for fewer seeds for speed. A diagram can set its own with `vars.d2-config.data.tala-seeds`, which wins, as natively.'],
  ['Link and tooltip behaviour', 'Click-through and hover text.', 'consumer-owned interaction', 'The scene carries the link regions and tooltip text; mount events report object clicks and hovers.'],
];
