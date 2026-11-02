# Native D2 and web rendering comparisons

Use D2's own examples as the inputs. Render each with the native CLI and TALA, render the same case through our web toolchain, then let Playwright compare the pictures. Screenshots are captured by repository tests in Chromium, locally and in CI; no manual or ChatGPT screenshot step is involved.

```text
one example workspace: D2 files + imports + assets
  ├─ native D2 + TALA → one or more reference SVGs
  └─ web toolchain   → corresponding React HTML/SVG scenes
                               ↓
         Chromium captures both → pixel comparison → pass or diff
```

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

## Automated image comparison

The web renderer supplies standalone HTML scenes in a matching directory tree. For example:

```text
artifacts/native/boards/all/diagram/x/y.svg
artifacts/web/boards/all/diagram/x/y.html
```

Each HTML page mounts the actual React rendering inside exactly one `[data-d2-scene]` element. Include its styles, fonts and assets; expose the element only when the matching compilation and assets are ready. It must represent the complete drawing at its native size, without editor toolbars. It must not embed the complete native SVG as a substitute for the React renderer. The page can use scripts and relative assets to mount the real components.

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
| `mise run check` | Tooling, inventory, cleanup, output sets, native fast cases, native/WASM scene data and browser comparison machinery |

After the web renderer has generated matching pages:

```sh
D2_WEB_OUTPUT=artifacts/web mise run test:parity
```

For the larger native output directory, also set `D2_NATIVE_OUTPUT=artifacts/native-corpus`. The parity command fails when the web output directory is missing, its board set differs, or the native run failed. It does not silently skip an unavailable renderer.

## Corpus coverage and CI

[imports/d2/](../imports/README.md#upstream-d2-source) contains the complete D2 source snapshot for investigation. All 79 file examples and 64 archive entries used by the corpus are copied into [examples/](../examples/README.md); tests never read or extract them from the external source checkout. Some examples are Go test literals rather than `.d2` files. The two multi-file cases were copied directly from those Go tests, with provenance in [examples/README.md](../examples/README.md). Further Go-defined cases still need to be adapted into ordinary example directories or exported by an upstream test adapter. The 147-run command is the file/archive corpus, not the complete upstream Go test suite or proof of full feature support.

[Development checks](../.github/workflows/check.yml) runs `mise run setup`, `mise run browser:install`, and `mise run check` on pushes and pull requests. A manual workflow run can additionally enable the full native corpus. Results are uploaded even on failure. This workflow has been written locally; it has not yet run on GitHub.

The two browser self-tests check the comparison machinery, not our renderer's fidelity. A standalone React geometry adapter now uses the same comparison helper for one real native-versus-React case, described below. General corpus integration still needs to consume every selected workspace, emit its HTML scenes, and run `mise run test:parity` as a required CI step. Do not count the self-test's intentionally identical SVG fixture as web parity.

## Native scene/WASM boundary probe

`mise run test:scene` compiles [the investigation helper](../research/geometry/scene-probe.go) against the loaded D2 source as native and `js/wasm` executables. It uses [geometry.d2](../examples/files/geometry.d2), runs TALA with seed `1`, builds the native D2 scene, and checks exact native-versus-Node/WASM JSON equality plus shape paint/geometry, object IDs, paint order, line trimming and arrowhead transform. Invalid source must not emit a partial scene.

The Go module uses its existing sums without modification. Go build/download caches are isolated in root `.cache/`; binaries, diagnostic JSON and the matching Go runtime are generated under `artifacts/scene-probe/`. The JSON is an investigation representation, not the production bridge schema. `mise run clean` already removes both locations.

`test:comparison` depends on `test:scene` and also runs [the Chromium/WASM scene probe](../tests/browser/scene-probe.spec.mjs). That browser test executes the same Go module without a Node filesystem shim and compares its result with native output. The browser tests share a single Playwright invocation so their report/output directories are not written concurrently.

`mise run check` and the existing CI workflow include these checks. They prove the native scene builder works in WASM for this fixture. They do not mount React, compare React pixels, or prove text/assets/effects support. The [porting map](porting-map.md#verified-geometry-scene-boundary) records the exact observed data-to-DOM mapping and current gaps.

## React geometry comparison

`mise run test:research:consumer` additionally builds two paired output trees and invokes this guide's actual `parity.spec.mjs`: the original label-free geometry and an explicit 160×80 source-size variant. These are real React GeometryScene comparisons with independent native CLI references at unchanged tolerances. The same task separately tests a packed native module and themed Card consumer; those custom Card visuals are not counted as native image parity. The resizing round trip uses native compilation via test transport, not a production browser-WASM sizing bridge. The full 147-run corpus still lacks corresponding web output.

`mise run test:scene` now also emits an explicitly tagged geometry subset, validates supported/unsupported data, creates a reference with the native D2 CLI, and bundles the standalone React components. Output is under `artifacts/scene-probe/`: `native.svg`, `geometry.json`, `react.html`, `react.js` and the existing native/WASM diagnostics. No external CDN or imported Studio dependency is needed for this proof.

`mise run typecheck` checks the strict TypeScript contract and component. The root `test:comparison` task includes `react-geometry.spec.mjs`, which mounts real React DOM, checks accessible structure and absence of image/SVG-string substitutes, and compares its bounds/pixels with the native SVG through the unchanged helper. It then updates a paint value through React and verifies DOM element reuse. The initial image is retained as `artifacts/scene-probe/react.png`.

The candidate receives native-generated scene JSON in this comparison. Native/Node-WASM/Chromium-WASM scene equivalence is proved separately for the same fixture; live browser compiler-to-React wiring is not yet implemented. This is one geometry parity case, not full React feature coverage or general corpus support. Curves, text/fonts, gradients, masks, effects, images, boards and editing remain unverified or explicitly rejected by the current subset.

## Current verification

The fast four native runs and the two Chromium comparison self-tests passed locally. The larger native corpus completed **145/147** runs successfully. The Twitter and WCC documentation examples failed because original remote image URLs returned DNS/HTTP errors; each run writes logs and partial outputs under `artifacts/native-corpus/` until the next run or `mise run clean`. They remain failures rather than skipped or accepted cases. Restore or faithfully cache those external assets before claiming a green complete corpus.

The full source is loaded, but matching the native CLI release to the imported Studio's WASM build and proving the React renderer's coverage remain separate work.
