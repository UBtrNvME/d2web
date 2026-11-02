# Native D2 and web rendering comparisons

Use D2's own examples as the inputs. Render each with the native CLI and TALA, render the same case through our web toolchain, then let Playwright compare the pictures. Screenshots are captured by repository tests in Chromium, locally and in CI; no manual or ChatGPT screenshot step is involved.

```text
one example workspace: D2 files + imports + assets
  ├─ native D2 + TALA → one or more reference SVGs
  └─ browser worker  → shipping mount's HTML/SVG DOM
                               ↓
         Chromium captures both → pixel comparison → pass or diff
```

## Production browser checks

`mise run test:client` runs the real worker/client/mount browser tests. `mise run test:features:paint` compiles the catalog in that browser, mounts the product painter and renders an independent native CLI SVG with matching options. The catalog includes root and selected non-root boards. It does not require a separate React renderer or `D2_WEB_OUTPUT` tree.

The catalog and the older external-output comparison helper have different checks:

| Check | What it establishes | Limits |
| --- | --- | --- |
| Catalog paint | At most 5% changed image pixels and 25% changed ink pixels; separately labelled one-pixel equivalents and intended web forms | A small missing or displaced label can pass a whole-board bar; interaction and update-under-zoom need dedicated checks |
| Unicode catalog | Consumer-font browser widths against D2 advances, glyph coverage and warnings | Not native glyph-pixel parity; native font fallback depends on the host |
| Semantic C1 | Zero changed pixels against the pre-semantic painter checkpoint | Protects positioned output for named cases; does not prove correct paint relative to native or under zoom |
| Markdown C2 | Browser-flow dimensions fit D2's markdown viewport | Closed opt-in subset; unsupported objects stay positioned |
| External `D2_WEB_OUTPUT` helper | Matching output trees, drawing size and the strict Playwright snapshot threshold below | Separate infrastructure and research geometry path; not the product catalog's 5% bar |

The [2 November browser review](web-native-audit.md) reproduced shifted/clipped text on update under CSS scale despite a passing catalog. Test the same result before and after update at the consumer's zoom, with fonts ready, and inspect individual labels and clip boundaries. Record text/content differences separately from shape geometry and native layout overlap. Match layout engine, TALA seed list, themes, source configuration and image bytes on both paths.

## Inputs and outputs

All conformance input files belong in the root `examples/` directory, including local images and imported helper files. `tests/examples.mjs` selects fast cases from `examples/cases.json` and discovers the complete file/archive set there. The full corpus no longer depends on fetching upstream source. Fixture names under `files/` are flattened; their original paths are recorded in the examples README. Archive entries are ordinary D2 files, so temporary extraction is unnecessary.

[cases.json](../examples/cases.json) describes ordinary example directories. Each case can have several runs, with different entry files or options. Every run can produce several output files. The board-import case tests both the complete board set and a selected nested board.

```json
{
  "id": "boards",
  "directory": "examples/boards",
  "runs": [{
    "id": "all",
    "entry": "main.d2",
    "outputs": ["diagram/index.svg", "diagram/x/index.svg", "diagram/x/y.svg"]
  }]
}
```

Keep all inputs together with their original paths. Helpers and imported files are not independent diagrams. The web compiler must receive the same workspace and entry path as the native compiler. Preserve source configuration; apply the same explicit run options on both paths. Native runs use TALA, seeds `1,2,3` (the d2 CLI default, as d2web uses), theme `0`, zero padding and scale `1`, unless a run overrides an option. D2's own configuration precedence still applies.

Generated native output goes under `artifacts/native/<case>/<run>/`; each run records its inputs/options in `case.json` and keeps stdout/stderr. Upstream source and goldens are not overwritten. The comparison rejects missing or extra boards and refuses partial SVGs from failed native compilations.

## External-output comparison helper

The web renderer supplies standalone HTML scenes in a matching directory tree. For example:

```text
artifacts/native/boards/all/diagram/x/y.svg
artifacts/web/boards/all/diagram/x/y.html
```

Each HTML page mounts the actual web rendering inside exactly one `[data-d2-scene]` element. Include its styles, fonts and assets; expose the element only when the matching compilation and assets are ready. It must represent the complete drawing at its native size, without editor toolbars. It must not embed the complete native SVG as a substitute for the web painter. The page can use scripts and relative assets to mount the real elements.

Playwright serves the fixture files through its request routing, so ES modules and relative fonts/assets work without starting another server. It opens both outputs in the same Chromium session, waits for fonts and HTML images, and captures their drawing bounds at device scale `1` and the same color scheme. Drawing width/height must match within `0.005` pixels. Candidate markup need not match the native SVG markup.

[playwright.config.mjs](../playwright.config.mjs) owns the thresholds:

- `threshold: 0.1` controls the perceived color difference at which an individual pixel counts as changed.
- `maxDiffPixelRatio: 0.001` allows at most **0.1%** changed pixels overall.

These are initial comparison settings, not certified tolerances for every D2 feature. Tighten or adjust them using actual renderer evidence; do not increase them just to hide missing elements. Pixel similarity does not prove source-editing semantics or interaction correctness.

The expected PNG is generated from the native SVG during the same test, not from the candidate. Snapshot updating is disabled and rejected by the comparison helper. On failure, Playwright writes actual/expected/diff images and an HTML report under `artifacts/`; native SVGs, logs and run options remain available beside them.

## Commands

Run these from the repository root:

```sh
mise run setup
mise run browser:install
mise run check
```

| Command | What it does |
| --- | --- |
| `mise run test:native` | Fast upstream chess, multi-file imports, and multiple-board cases: four runs |
| `mise run test:comparison` | Native fast cases and scene probe, then browser comparison self-tests and Chromium/WASM scene equality |
| `mise run test:scene` | Build and compare native and Node/WASM geometry scene output |
| `mise run test:native:corpus` | All 79 copied upstream files, 64 extracted archive inputs, and the fast cases: 147 runs |
| `mise run test:parity` | Compare existing native SVGs with web-rendered HTML scenes |
| `mise run test:client` | Product worker/client/mount browser checks, including text, rich content, events and images |
| `mise run test:features:paint` | Product catalog versus native CLI in the selected browser; records raw differences and guards the baseline |
| `mise run check` | Fast tooling, unit, type, native and Node/WASM checks; no browser launch |
| `mise run check:browser` | Browser suites, including research and packaged consumers |
| `mise run check:full` | Fast plus browser gates |

After the web renderer has generated matching pages:

```sh
D2_WEB_OUTPUT=artifacts/web mise run test:parity
```

For the larger native output directory, also set `D2_NATIVE_OUTPUT=artifacts/native-corpus`. The parity command fails when the web output directory is missing, its board set differs, or the native run failed. It does not silently skip an unavailable renderer.

## Corpus coverage and CI

[imports/d2/](../imports/README.md#upstream-d2-source) contains the complete D2 source snapshot for investigation. All 79 file examples and 64 archive entries used by the corpus are copied into [examples/](../examples/README.md); tests never read or extract them from the external source checkout. Some examples are Go test literals rather than `.d2` files. The two multi-file cases were copied directly from those Go tests, with provenance in [examples/README.md](../examples/README.md). Further Go-defined cases still need to be adapted into ordinary example directories or exported by an upstream test adapter. The 147-run command is the file/archive corpus, not the complete upstream Go test suite or proof of full feature support.

[Development checks](../.github/workflows/check.yml) runs setup/build and `mise run check` on pushes and pull requests. Browser installation is a workflow step, but the browser suites themselves run only when a manual dispatch sets `browser=true`; a separate manual option enables the full native corpus. Results are uploaded even on failure. This describes the checked-in workflow, not a verified latest CI result.

The two browser self-tests check the comparison machinery, not our renderer's fidelity. A standalone React geometry adapter now uses the same comparison helper for one real native-versus-React case, described below. General corpus integration still needs to consume every selected workspace, emit its HTML scenes, and run `mise run test:parity` as a required CI step. Do not count the self-test's intentionally identical SVG fixture as web parity.

## Native scene/WASM boundary probe

`mise run test:scene` compiles [the investigation helper](../research/geometry/scene-probe.go) against the loaded D2 source as native and `js/wasm` executables. It uses [geometry.d2](../examples/files/geometry.d2), runs TALA with seed `1`, builds the native D2 scene, and checks exact native-versus-Node/WASM JSON equality plus shape paint/geometry, object IDs, paint order, line trimming and arrowhead transform. Invalid source must not emit a partial scene.

The Go module uses its existing sums without modification. Go build/download caches are isolated in root `.cache/`; binaries, diagnostic JSON and the matching Go runtime are generated under `artifacts/scene-probe/`. The JSON is an investigation representation, not the production bridge schema. `mise run clean` already removes both locations.

`test:comparison` depends on `test:scene` and also runs [the Chromium/WASM scene probe](../tests/browser/scene-probe.spec.mjs). That browser test executes the same Go module without a Node filesystem shim and compares its result with native output. The browser tests share a single Playwright invocation so their report/output directories are not written concurrently.

The native/Node half runs in `mise run check`; the Chromium half runs through `test:comparison` in `check:browser`. They prove the native scene builder works in WASM for this fixture. They do not mount React, compare React pixels, or prove text/assets/effects support. The [porting map](porting-map.md#verified-geometry-scene-boundary) records the observed research data-to-DOM mapping and its limits.

## React geometry comparison

`mise run test:research:consumer` additionally builds two paired output trees and invokes this guide's actual `parity.spec.mjs`: the original label-free geometry and an explicit 160×80 source-size variant. These are real React GeometryScene comparisons with independent native CLI references at unchanged tolerances. The same task separately tests a packed native module and themed Card consumer; those custom Card visuals are not counted as native image parity. The resizing round trip uses native compilation via test transport, not a production browser-WASM sizing bridge. The full 147-run corpus still lacks corresponding web output.

`mise run test:scene` now also emits an explicitly tagged geometry subset, validates supported/unsupported data, creates a reference with the native D2 CLI, and bundles the standalone React components. Output is under `artifacts/scene-probe/`: `native.svg`, `geometry.json`, `react.html`, `react.js` and the existing native/WASM diagnostics. No external CDN or imported Studio dependency is needed for this proof.

`mise run typecheck` checks the strict TypeScript contract and component. The root `test:comparison` task includes `react-geometry.spec.mjs`, which mounts real React DOM, checks accessible structure and absence of image/SVG-string substitutes, and compares its bounds/pixels with the native SVG through the unchanged helper. It then updates a paint value through React and verifies DOM element reuse. The initial image is retained as `artifacts/scene-probe/react.png`.

The candidate receives native-generated scene JSON in this comparison. Native/Node-WASM/Chromium-WASM scene equivalence is proved separately for the same fixture; live browser compiler-to-React wiring is not yet implemented. This is one geometry parity case, not full React feature coverage or general corpus support. Curves, text/fonts, gradients, masks, effects, images, boards and editing remain unverified or explicitly rejected by the current subset.

## Verification history and current review

The earlier research run recorded four fast native runs and two Chromium comparison self-tests passing, and the larger native corpus completed **145/147** runs successfully. Twitter and WCC failed on remote image URLs. That is a historical result; the 147-run corpus was not rerun in the 2 November text review. Restore or faithfully cache those external assets before claiming a green complete corpus.

The [browser audit](web-native-audit.md) and [task ledger](../tasks/todo.md#browser-review-2-november-2026) record the current product checks, matched AWS/text comparisons, zoom defect and setup limits. The imported Studio's independent WASM build and the React geometry research remain separate evidence.
