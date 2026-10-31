# D2 → d2web porting map

Latest direction: native HTML/JavaScript/CSS/SVG is the preferred foundation for future React bindings. React-specific rows below describe candidate bindings and existing proof, not a mandatory core runtime. React Flow research is now focused on connection drawing, markers and separate hit targets; JointJS is comparison material, not a selected base. Consumer components such as shadcn remain explicit optional presentation above faithful D2 behavior.

Status: design map, 30 October 2026. Source inspection establishes the boundaries below; it does not establish runtime parity. The browser API, runtime build correspondence and individual conversions still need executable verification.

Current phase: [architecture research](../tasks/plan.md), with [ordered experiments](../tasks/todo.md). Existing React mappings are candidate mappings and subset evidence, not a settled foundation for every web capability. Compare semantic-first, scene-first and combined boundaries, then evaluate browser primitives/framework bindings separately. Source ownership, accessibility, interaction, embedding and explicit lifecycle matter alongside rendering. The immediate next task is R1, semantic/source association; older implementation-first next steps below are historical. No implicit reskinning, application policy or unrequested browser effects belong in d2web.

Execution update: [research findings](research-findings.md) now records source-linked framework comparison and local native/Node-WASM identity, native-operation/measurement and browser composition probes. R1's bounded projection is executed; complete source association and full renderer/interaction parity remain unproven. An invalid native edit can mutate its input AST, and identical text keys do not establish independently sized consumer content. These results constrain a future bridge; they do not select a representation/framework.

## Product direction and accepted rendering boundary

### Native browser foundation and future React binding

The current preference is an ordinary browser library: native ES modules/JavaScript, HTML content, SVG geometry and explicit CSS. TypeScript can provide authoring checks and declarations without becoming a browser runtime requirement. This direction is accepted; exact modules, schemas, lifecycle APIs and DOM topology still require evidence. React Flow/JointJS are studied to understand reusable web patterns, especially connections, rather than to adopt their graph stores as the D2 document.

| Capability | Native browser candidate | D2 authority / remaining evidence |
| --- | --- | --- |
| Compilation and layout | Explicitly initialized Go/WASM runtime; worker remains a candidate | Native parser/compiler/measurement/layout/routing, including TALA; keep files/configuration/versions and failure behavior |
| Data boundary | Framework-independent structured JavaScript values, with optional static types | Preserve board/revision identity, source contributors and native paints/geometry; raw graph/scene JSON is not yet a sufficient public contract |
| Connections and outlines | SVG path/rect/ellipse/group created with native DOM APIs; direct D2 attributes/transforms | Native route trimming, outlines, arrowhead geometry, label masks and paint order; browser path syntax is serialization, not rerouting |
| Content | Native HTML and/or SVG text with actual D2 font assets | Text shaping, baselines, fallback, rich content and source association must be measured; do not substitute browser defaults silently |
| Pointer interaction | Native events; optional separate transparent path around an edge | Consumer chooses hit width, selection and gestures; interaction geometry must not change the painted D2 stroke |
| Coordinates | SVG transforms, DOMMatrix/getScreenCTM conversion and explicit viewport input | D2 document coordinates stay separate from consumer viewport; nested scroll/zoom and nonuniform transforms remain to test |
| Styles/themes | Native SVG attributes and scoped CSS sourced from effective D2 values | Consumer design systems are opt-in layers; CSS isolation versus inheritance must be decided through embedding tests |
| Library lifecycle | Explicit mount/update/dispose or equivalent, with caller-owned resources | Import must not initialize workers, fetch assets, persist or install global policy; precise API is not selected |
| Future React components | Either React renders the same primitive data, or mounts a separately owned native subtree | Compare both ownership models. Avoid React and imperative code updating the same nodes. React must not become a core dependency merely to share data rules |
| Custom representation | Explicit consumer-owned HTML/component content and overlays | Fixed footprint is distinct from changed-size native relayout; shadcn/Tailwind belong to the consumer |

Web Components and Shadow DOM are possible packaging/isolation choices, not prerequisites for being close to the platform. Plain modules/functions may be sufficient. Likewise, a future React binding need not wrap a new imperative rendering engine if shared data/geometry contracts let React own its own elements. Test cleanup, update ordering, events, styles and consumer composition before settling that choice.

The source for these browser primitives is the [DOM standard](https://dom.spec.whatwg.org/#dom-document-createelementns) and [SVG path standard](https://www.w3.org/TR/SVG2/paths.html); React documents both [external-system lifecycle](https://react.dev/reference/react/useEffect) and [portals into non-React DOM](https://react.dev/reference/react-dom/createPortal). These sources establish mechanisms, not d2web interoperability. Local evidence and gaps are recorded in the [research findings](research-findings.md).

Updated research requirement: evaluate React Flow/JointJS-style composition, library consumption and consumer-owned alternative node/content presentation (including shadcn). A faithful D2 default and explicitly opted-in custom representations must coexist. The older restriction below that all consumer appearance changes must use D2 configuration is superseded: downstream components may replace presentation, with explicit geometry/layout contracts. See the [framework and customization research](../tasks/plan.md#web-diagramming-prior-art-and-library-composition); APIs and adoption remain open.

Make d2web a reusable browser runtime/integration and native web presentation library within the D2 toolchain, suitable for future React bindings. Studio is a future consumer. Preserve ordinary D2 files and reuse D2 implementations. Keep changes needed by browser consumers separable and suitable for proposing upstream. Official inclusion in the D2 distribution is a later maintainer decision, not an existing integration.

d2web owns compiler/runtime access, faithful scene/paint mapping, rendering components and characterized native operation contracts. Consumers own their source-editor widgets, panels, canvas gestures, selection state, undo/persistence policy and visual product design. The imported Studio is a reference consumer, not the application being built here. Its Tailwind/Vinext stack is not a d2web dependency requirement.

The user accepted **HTML and native SVG DOM elements**, initially through React. The current preference is a native browser foundation with React as a later binding. Nodes, connections and labels are individually addressable browser elements with explicit event/component integration. D2 supplies semantic and geometric information. A complete D2-generated SVG embedded as one image or HTML string does not establish the required programmable surface.

“One-to-one” means each D2 feature and effective value has an explicit destination and a verified conversion. It does not mean every D2 keyword is a CSS property: some affect compilation, some select geometry, some resolve themes, and some are already consumed before rendering.

## Complete renderer and future editor integration

The target is the full D2 web runtime and browser presentation, suitable for future React components. Shapes, connections, containers, text/Markdown/code/math, structured diagrams, images/icons, styles, themes, effects, boards, ordering and interactivity all belong in the capability map. Geometry is one layer of that system. The current `GeometryScene` React component names its proven subset accurately; a future whole-diagram component must not claim complete support until the relevant cases pass.

| Integration boundary | d2web responsibility | Future editor responsibility |
| --- | --- | --- |
| Runtime | Compile workspaces/configuration; correlate results; diagnostics and lifecycle | Decide when to compile and which source revision to display |
| Semantic and scene data | Preserve D2 identities, references, hierarchy, geometry and effective appearance | Build outlines, inspectors, searches and application views |
| React rendering | Render all supported D2 content with native HTML/SVG; preserve object/event association | Compose the renderer into a canvas and decide selection/gesture behavior |
| Viewport integration | Define document coordinates and expose bounds/transforms needed by consumers | Own pan/zoom, overlays and viewport state |
| Native operations | Expose characterized D2 edit/format operations with atomic results and source ownership | Bind tools/commands and manage history, saves and collaboration |

These boundaries are intended extension points for consumers such as `d2editor`. Exact contracts, events and component composition should follow verified cases. They do not require a generic plugin framework, arbitrary paint overrides or replacement layout semantics. A consumer changing diagram appearance must do so through D2 semantics/configuration; editor affordances can be separate consumer-owned overlays.

## Ownership: reuse, expose, render

```text
ordinary .d2 files + entry path + explicit configuration
  -> D2 Go code compiled to WASM, behind a worker
       parser -> IR/compiler -> themes/measurement -> layout/routing -> target
  -> existing JS response + only the missing, characterized D2 data
  -> typed TypeScript boundary
  -> React components owning HTML and SVG DOM

consumer operation request -> native D2 edit API -> updated .d2 files -> same pipeline
```

Geometry and appearance sometimes live in the reference renderer, beyond the exported target. Do not mistake target JSON for a complete paint specification. Prefer exposing reusable D2 geometry/paint calculations through Go/WASM over inventing a second geometry engine in TypeScript. Whether those calculations can be exposed with a small adapter or need upstream refactoring is an investigation item.

## Source baseline

This pass inspected the official `v0.9.0` source tag. That is the initial source reference, not proof that the imported package's WASM was built from precisely that source. Resolve the tag to a commit and record wrapper/WASM/font hashes before using it as a reproducible parity baseline. Do not mix the earlier audit's newer upstream commit into this contract.

The source is now available locally at `imports/d2/`; [its source note](../imports/README.md#upstream-d2-source) records the resolved commit. [Native TALA and browser comparison tests](conformance.md) provide the first executable test infrastructure. Matching the imported WASM and native source builds remains unresolved.

| Reference | Inspected responsibility |
| --- | --- |
| [D2 JS declarations](https://github.com/d2lang/d2/blob/v0.9.0/d2js/js/index.d.ts) | Public compile/render/dispose boundary and response types |
| [WASM functions](https://github.com/d2lang/d2/blob/v0.9.0/d2js/d2wasm/functions.go) | Browser-facing Go operations; separate from the public JS class |
| [D2 orchestration](https://github.com/d2lang/d2/blob/v0.9.0/d2lib/d2.go) | Compiler options, measurement, layout and target generation |
| [Keyword registry](https://github.com/d2lang/d2/blob/v0.9.0/d2ast/keywords.go) | Source feature names, including the 20 style keywords |
| [Graph model](https://github.com/d2lang/d2/blob/v0.9.0/d2graph/d2graph.go) | Authored attributes, references, hierarchy and theme state |
| [Exporter](https://github.com/d2lang/d2/blob/v0.9.0/d2exporter/export.go) | Graph-to-target conversion and theme-specific rules |
| [Target model](https://github.com/d2lang/d2/blob/v0.9.0/d2target/d2target.go) | Shapes, text, connections, boards, geometry helpers and registries |
| [Reference renderer](https://github.com/d2lang/d2/blob/v0.9.0/d2renderers/d2svg/d2svg.go) | Paint order, paths, markers, masks, effects and theme CSS |
| [Reference base styles](https://github.com/d2lang/d2/blob/v0.9.0/d2renderers/d2svg/style.css) | Line caps/joins and blend behavior |
| [Oracle editing](https://github.com/d2lang/d2/blob/v0.9.0/d2oracle/edit.go) | Native source operations and board/scope restrictions |
| [SVG path standard](https://svgwg.org/svg2-draft/paths.html) | Native browser path geometry and DOM interfaces |

## Subsystem and technology map

Component names below describe proposed library responsibilities, not implemented modules or newly available public APIs. React/TypeScript form the initial adapter; consuming application frameworks and UI libraries are outside this map.

| D2 concern | Implementation technology | d2web responsibility | Evidence needed before completion |
| --- | --- | --- | --- |
| Files and imports | D2 virtual filesystem via the JS compile request | Accept exact workspace contents and entry path from a consumer | Relative, selective/spread, missing and cyclic import cases; path containment |
| Syntax, comments and diagnostics | Existing Go parser/AST in WASM | Expose source ranges and diagnostics to consumers | UTF-16 positions, quoted IDs, blocks, incomplete input |
| Variables, classes, globs and overrides | Existing D2 IR/compiler in WASM | Inspect authored and effective values; never use CSS cascade as D2 inheritance | Precedence, null, propagation and declaration-order cases |
| Models and board inheritance | Existing D2 compiler/graph | Expose board enumeration/selection data and inherited results | Layers/scenarios/steps, suspension and imported ownership |
| Defaults, validation and units | D2 compiler/graph/exporter | Preserve resolved numbers and absence; reject unsupported boundary data | Zero versus absent, invalid values, defaults per object kind |
| Theme rules and palette | D2 theme/export/render code in Go/WASM | React theme context consumes effective appearance and palettes | Light/dark overrides, explicit styles and structural theme rules |
| Fonts and text measurement | D2 font/measurement code; browser FontFace API for matching files | Load corresponding fonts before layout comparisons; explicit text runs | Family aliases, regular/bold/italic, line breaks and baseline metrics |
| TALA/Dagre/ELK | Existing D2 WASM engines | Select explicit compile configuration and preserve output | Matching versions/options, repeated runs and failure behavior |
| Grids, sequence layout, near and hierarchy | D2 nested-layout orchestration | Preserve specialized output and identify synthetic elements | Nested/specialized diagrams, constraints and routing |
| Shape outlines and inner boxes | D2 geometry helpers, exposed through a proposed bridge where missing | React `D2Shape` owns SVG rect/ellipse/path primitives and HTML content | Every registered shape, size, stroke and label/icon position |
| Connection routes | D2 layout plus reference-renderer path calculations | React `D2Connection` owns native SVG paths | Curves, rounded bends, endpoint trimming, loops, parallel edges |
| Arrowheads and connection labels | D2 target/renderer geometry helpers | React marker/path and text components | Every enum variant, stroke-dependent size and endpoint labels |
| Solid paint, gradients and patterns | D2 palette/paint rules; React SVG paint definitions | Typed fill/stroke/paint references; diagram-local definition IDs | All paint kinds, bounds, pattern scale and duplicate diagrams |
| Shadow, multiple, 3D, double border, sketch | D2 renderer calculations and assets | React owns explicit extra primitives/filters | Shape-specific applicability, bounds, order and effect combinations |
| Text and rich content | D2 text/content behavior plus React HTML/SVG text primitives | `D2Text`/rich-content components reproduce verified runs and bounds | Markdown, code, math, links, line metrics and styling corpus |
| SQL tables and UML classes | D2 structured target/geometry | React row/field components, D2-derived separators and ports | Headers, row metrics, visibility, constraints and accents |
| Images, icons, links and tooltips | D2 placement data plus browser DOM/image/link APIs | React native elements with controlled URL handling | Intrinsic dimensions, missing assets, board links, focus and tooltip behavior |
| Root background and legend | D2 root/legend data plus renderer placement rules | React background and legend using the same paint/text components | Root styles, legend-only bounds and exports |
| Paint order, masking and blend | D2 renderer order/mask/blend rules | One consistent scene coordinate system across HTML and SVG | Interleaved nodes/edges, nesting, border labels and translucent groups |
| Structural editing and formatting | Existing `d2oracle`/`d2format` in Go; proposed WASM exposure | Accept operation requests; return atomic source changes, references and diagnostics | Scope/import/board restrictions and failure atomicity |
| Worker lifecycle and freshness | Existing D2 worker plus TypeScript request identities | Correlate results; handle failure/disposal; allow consumer freshness decisions | Stale responses, errors, repeated startup and expensive requests |
| Selection, viewport and gestures | Consumer responsibility | Expose stable object IDs and geometry that consumer interactions can use | No consumer state changes library document semantics |
| Inspector, outline and classes UI | Consumer responsibility | Expose graph/source provenance and authored/effective values | Inherited versus explicit and source ownership |
| Undo and persistence | Consumer responsibility | Provide complete atomic changes needed by a consumer's history/storage | No hidden partial mutation or application storage dependency |
| D2/SVG export | D2 files and native render API | Export ordinary D2 and reference output with matching options | Reopen with D2 CLI, multi-file contents and diagram configuration |
| Editor shell | Consumer responsibility | Consume d2web APIs/components within the application's own UI | Application styles cannot change diagram values or geometry |

Source-editor widgets, application frameworks, backends, databases and collaboration services are consumer choices. Library development and validation must work without installing or changing the imported Studio.

## Styling contract: all 20 source keywords

Read **effective** values from D2. Keep authored source/provenance separately for editing. The exact path from authored scalar to effective target depends on object type and D2 rules; the renderer does not recalculate inheritance. A symbol mentioned here is not necessarily exposed by the current public JS wrapper.

| D2 `style` keyword | D2 output or semantic owner | React/DOM destination | Conversion or parity obligation |
| --- | --- | --- | --- |
| `opacity` | Target `opacity`; renderer grouping rules | SVG/group or HTML opacity at the matching scope | Preserve compositing scope; applying opacity to each child separately can differ |
| `stroke` | Target `stroke`, palette/gradient resolution | SVG `stroke` | Resolve D2 paint, including transparent/none and gradients |
| `fill` | Target `fill`, palette/gradient resolution | SVG `fill`; matching background for content only where specified | Do not fill the label rectangle or substitute a service-card color |
| `fill-pattern` | Target `fillPattern` and D2 pattern assets/rules | React-owned SVG pattern/paint definitions | Reuse exact pattern scale, phase, color and assets; no invented CSS texture |
| `stroke-width` | Target `strokeWidth` | SVG `strokeWidth` | Centered stroke and bounds follow D2; HTML border changes the box differently |
| `stroke-dash` | Target `strokeDash` plus D2 dash helper | SVG `strokeDasharray` | Reuse D2's stroke-width-dependent dash/gap calculation; value is not a CSS dashed-border enum |
| `border-radius` | Target `borderRadius`; shape/connection renderer | Rect radii or D2-derived path bends | Does not mean one CSS radius applied to every shape or connection |
| `font` | D2 family selection, theme rules and matching font assets | HTML `fontFamily` or SVG `fontFamily` | Resolve D2 aliases and load the actual font files |
| `font-size` | Target `fontSize`, measured label geometry | HTML/SVG `fontSize` in scene units | No fitting/scaling text to conceal a measurement mismatch |
| `font-color` | Target text `color` plus D2 font-color fallback rules | HTML `color` / SVG text `fill` | Preserve shape-specific defaults and palette resolution |
| `bold` | Target text `bold`, D2 font selection | HTML/SVG `fontWeight` | Matching font variant and metrics, including structured shapes |
| `italic` | Target text `italic`, D2 font selection | HTML/SVG `fontStyle` | Matching font variant and metrics |
| `underline` | Target text `underline`, rich-content rules | Text decoration or D2-derived decoration primitive | Baseline/decoration parity; do not assume browser defaults match |
| `text-transform` | D2 text semantics; not a dedicated target text field | Render already transformed text/runs | Trace where transformation is consumed; do not apply a second CSS transformation |
| `shadow` | Target `shadow`, D2 reference filter | React-owned SVG filter primitives | Match D2 blur/offset/color/region; no arbitrary `box-shadow` |
| `multiple` | Target `multiple`, D2 duplicate-outline rules | Additional React SVG geometry | Exact count, offset, paint order and bounds |
| `double-border` | Target `double-border`, D2 inner-border rules | Additional inner outline | Shape-dependent inset geometry; CSS `border: double` is not the contract |
| `3d` | Target `3d`, D2 extrusion and face-paint rules | Additional face/border paths | Preserve supported types, offsets, shading and connection geometry; no CSS perspective |
| `animated` | Target `animated`, D2 connection animation rules | Native SVG stroke properties with matching animation rules | Reuse dash timing/direction; validate reduced-motion presentation separately |
| `filled` | D2 arrowhead selection; resolved arrowhead variant | Arrowhead fill/path component | Arrowhead-scoped meaning; do not treat it as a general node fill boolean |

Every row is **mapped, implementation unverified**. Values and converters require cases for each applicable object type. CSS is allowed as an explicit browser mechanism; arbitrary visual tuning is not. Reference-renderer CSS must also be accounted for: line caps/joins and blend groups affect the output independently of authored style keywords.

## Theme mapping

D2 themes affect more than colors. Exporter inspection shows special rules that can select fonts, container borders, fill patterns and C4-specific appearance. Resolve those through D2 before painting. The renderer also resolves palette tokens, defaults, gradients and light/dark rules.

| D2 input/state | Proposed transfer into React | Required check |
| --- | --- | --- |
| Theme ID and source configuration | Effective D2 compile/render configuration | Same option/source precedence as D2 |
| Neutral tokens `N1`–`N7` | D2 palette entries in diagram-scoped React theme context | Each token matches the reference output |
| Base tokens `B1`–`B6` | Same palette/context | Each token matches, including container levels |
| Accent tokens `AA2`, `AA4`, `AA5`, `AB4`, `AB5` | Same palette/context | Accents match structured and ordinary shapes |
| Theme overrides | Apply native override logic before publishing the palette | Partial overrides, explicit literals and untouched slots |
| Dark theme and dark overrides | Native second palette and configuration rules | Reference dark-mode activation; editor-shell dark mode is separate |
| Theme special rules | Effective target/geometry, not React theme heuristics | Fonts, patterns, borders and C4 behavior |
| Authored literal paint | Preserve D2's effective result | A theme switch must not replace an explicit literal arbitrarily |
| Graph/target defaults | D2's shape/connection-specific getters and export rules | Text color, strokes, opacity and arrowhead defaults |

The Go graph includes theme state; the public JS type surface does not prove a complete stable palette/paint interface. First inspect actual compile responses. If data is missing, propose a structured Go/WASM export that calls the native theme code. Do not reconstruct the palette by guessing colors from a screenshot or replace it with Tailwind tokens. Diagram-scoped CSS variables may carry the resolved palette, but their values must originate from D2.

## Shape mapping: all 25 registered source names

The target registry supplies these names. This is a source-name inventory; aliases and specialized layout types do not necessarily survive as 25 separate painted types. `square` and `circle` normalize to rectangle and oval in the target, while authored identity stays in source/graph.

| D2 source shape(s) | React/browser representation | D2 geometry dependency |
| --- | --- | --- |
| `rectangle`, `square` | `D2Shape` with SVG rect/path; optional HTML label content | Bounds, corner rules, inner box, effects |
| `oval`, `circle` | SVG ellipse/path | Bounds, inner label box, boundary intersections |
| `page` | SVG paths | Page outline and inner box |
| `parallelogram` | SVG paths | Slanted outline and label area |
| `document` | SVG paths | Curved lower border |
| `cylinder` | SVG paths | Curved caps, body and label box |
| `queue` | SVG paths | End caps and body |
| `package` | SVG paths | Tab and body outline |
| `step` | SVG paths | Stepped/notched outline |
| `callout` | SVG paths | Callout outline and label area |
| `stored_data` | SVG paths | Curved sides |
| `person` | SVG paths | Body/head geometry |
| `c4-person` | SVG paths | C4-specific silhouette and content area |
| `diamond` | SVG paths | Vertices, inner box and attachment geometry |
| `hexagon` | SVG paths | Outline, inner box and effects |
| `cloud` | SVG paths | D2 cloud contours |
| `text` | React HTML text/rich content, or SVG text primitives where required | D2 measured runs, positions and metrics |
| `code` | React code/token elements or positioned SVG text | Native token styles, lines and dimensions |
| `class` | React field/method rows plus SVG outline/separators | Header/row geometry, visibility and accent colors |
| `sql_table` | React column rows plus SVG outline/separators | Row metrics, constraints, accents and connection ports |
| `image` | Native image element owned by React | D2 aspect ratio, sizing, bounds and asset resolution |
| `sequence_diagram` | Dedicated React composition of D2-generated objects | Actors, lifelines, spans, groups, messages and synthetic ownership |
| `hierarchy` | Dedicated hierarchy mapping after inspecting compiler output | Specialized layout/output semantics; no generic rectangle fallback |

Do not use pseudo-elements, clipped divs or rotated borders to approximate these shapes. Share D2's exact geometry through a characterized interface. An individual React component can contain native SVG geometry and HTML content; React ownership does not require an HTML-only silhouette.

## Field coverage beyond style keywords

The field register must be generated/checked against actual Go JSON and runtime responses before implementation. Public TypeScript declarations already differ from the inspected Go model, so copying that declaration file alone is insufficient.

| Data group | Fields/values to preserve | Consumer and rule |
| --- | --- | --- |
| Identity and reuse | `id`, `type`, `classes` | Stable React identity plus source/graph provenance; D2 classes are not browser CSS class names |
| Position and size | `pos`, `width`, `height` | Scene coordinates and explicit dimensions; one shared viewport transform |
| Depth/order | `zIndex`, `level`, renderer sort order | Reproduce D2 paint order, including ties and node/edge interleaving |
| Composition | Root, layers, scenarios, steps, folder-only boards, description | Board selection and inheritance without flattening the source |
| Text | `label`, `language`, `fontFamily`, `fontSize`, `color`, `bold`, `italic`, `underline`, `labelWidth`, `labelHeight`, `labelFill` | Typed text/rich-content renderer preserving measured bounds |
| Labels/assets | `labelPosition`, `iconPosition`, `icon`, icon corner radius, tooltip and tooltip position | Native geometry/placement; some fields require Go/WASM schema updates |
| Interactivity | `link`, `prettyLink`, tooltip | Native links/accessible tooltip presentation with safe URL handling; board links remain board references |
| Structured content | Class fields/methods; SQL column text, constraints and references | Preserve per-row information and source ownership |
| Structured appearance | Primary/secondary/neutral accent colors | D2 palette resolution, not generic table colors |
| Shape composition | `blend`, `contentAspectRatio`, all effective effect flags | D2 compositing, fitting and clipping rules |
| Connection identity | `src`, `dst`, indexed edge identity and classes | Preserve ports/endpoint ownership through graph/geometry where needed |
| Connection geometry | `route`, `isCurve`, `borderRadius` | Native path construction, corner rounding and endpoint adjustments |
| Arrowheads | `srcArrow`, `dstArrow` | Native enum-to-geometry mapping with stroke-dependent dimensions |
| Connection labels | Inherited text fields, `srcLabel`, `dstLabel`, `labelPosition`, `labelPercentage` | D2 path-position and endpoint-label helper calculations |
| Connection appearance | Stroke, fill, opacity, dashes, animation, icon, link, tooltip, z-order | Same paint and interactivity contract as appropriate to connections |
| Global output | Render options, diagram fonts/mono fonts, padding/centering/scale, legend | Preserve source/options provenance; keep viewport zoom separate from document geometry |

Arrowhead target variants to characterize: `none`, `arrow`, `triangle`, `unfilled-triangle`, `diamond`, `filled-diamond`, `circle`, `filled-circle`, `box`, `filled-box`, `cross`, `line`, `cf-one`, `cf-many`, `cf-one-required`, `cf-many-required`. Not every target variant is an authored `arrowhead.shape` value. Some are selected by `filled` or internal rendering logic.

## The renderer boundary that still needs designing

Positions, sizes and route points are exposed by compilation. Complete outlines, trimmed connection paths, label positions, masks, paint definitions and glyph/rich-content geometry may require native helpers. A proposed bridge should expose exactly those missing computations using a pinned schema; it is not an existing `compile` API feature.

Candidate outputs to investigate are shape outline/inner-box data; final connection path/marker/label geometry; resolved palettes and paints; effect primitives; and ordered text runs with font/metric information. Reuse an existing upstream representation if one provides this information. Do not design a new generic scene language until that search is complete.

HTML rich content is a major parity risk. The prototype's React Markdown/highlighter/KaTeX stack is not a proven substitute for D2 parsing, highlighting, math, text shaping or measurement. Compare each output and reuse native content calculations or expose runs when needed. A discrepancy remains an explicit gap until resolved; automatic text scaling cannot make it supported.

HTML/SVG composition also needs a proof for interleaved paint order, masks, outside labels and blend groups. Choose the DOM topology after that proof; a permanently separate “all edges behind all nodes” layer is not assumed to preserve D2 ordering.

## How this becomes part of the D2 toolchain

1. Preserve `.d2` files, virtual filesystem semantics and explicit D2 configuration so files compile in ordinary D2 tools without a conversion format.
2. Reuse upstream Go packages in WASM; avoid reimplementing language semantics, theme rules, layout or routing in the frontend.
3. Keep browser API/schema improvements separate from React UI work, with native and WASM tests. Potential upstream work includes missing typed fields, geometry/paint access and characterized editing operations.
4. Treat the React renderer as an additional consumer of shared D2 data/calculations. Compare it with native output and run compatibility cases when D2 is upgraded.
5. Propose reusable changes upstream with examples and regression evidence. Determine repository/package ownership and any official plugin/renderer extension point with maintainers before claiming official integration.

No current renderer plugin registration, upstream contribution acceptance or package name is assumed by this proposal.

## Verification contract and next work

Each feature case must record: source file and owning symbol; source input; exact source/runtime versions; effective graph/target value; conversion or native helper; React component and DOM property; native/browser comparison; status and remaining gaps. The tables above give coverage categories, not completed tests.

First prove a small but representative document containing nested shapes, a curved/rounded connection, class inheritance, a literal paint, a theme token, dark overrides and a measured label. Inspect native versus browser compilation, then expose only the missing renderer data. That experiment determines the bridge and DOM topology before implementing the full renderer.

Afterward expand cases across all 20 style keywords, all 25 source shape names, every arrowhead variant, all theme palette slots/rules and each subsystem row. Include combinations: opacity with overlapping primitives, dark themes with explicit colors, thick strokes with rounded edges, nested effects, structured content and imported/inherited declarations. Check source-editing atomicity and exact undo separately from visual comparison.

## Verified geometry scene boundary

`geometry.d2` now has an executable investigation probe: [Go helper](../tests/scene-probe.go), [native/Node-WASM assertions](../tests/scene.test.mjs), and [Chromium-WASM assertion](../tests/browser/scene-probe.spec.mjs). Run `mise run test:scene` for the native/Node check; `mise run check` also runs the browser check. These exercise D2's actual compiler, TALA seed `1` and scene builder, with zero padding and scale `1`. No imported D2 or Studio source was changed.

The same probe builds as a native executable and as `GOOS=js GOARCH=wasm`. Native, Node/WASM and Chromium/WASM produced exactly equal parsed target and scene JSON for this fixture. The browser runs the Go program without a Node filesystem shim. A malformed D2 input fails without emitting a partial scene. This is a verified execution boundary; it is not a React visual-parity result.

### Exact native-data → React element mapping

The output contains nine nodes: four groups, a background rectangle, one source rectangle, one target ellipse, one connection path and one diamond path. The following browser destinations remain to be implemented as React components; the D2 values and calculations have been executed and checked.

| D2 owner | Observed native scene data | React-owned browser destination |
| --- | --- | --- |
| `d2scenebuild.buildDocument` | View box `(-2, -1, 213, 44)`; logical dimensions `213 × 44`; meet fitting | `<svg viewBox="-2 -1 213 44" width={213} height={44} preserveAspectRatio="xMinYMin meet">` |
| `buildDocument` | `root:background`, white rectangle covering that view box | React `<rect>` with those exact bounds and paint |
| `buildShape` and `buildOrdinaryShapeOutline` | Group `source`; rectangle at `(0, 3)`, `56 × 36`, zero corner radii | React group preserving source identity plus `<rect x={0} y={3} width={56} height={36}>` |
| Native scene paint/stroke | Source fill NRGBA `(255,107,107,255)`; stroke `(16,42,67,255)`, width `3`, butt caps, round joins | `fill="#ff6b6b"`, `stroke="#102a43"`, `strokeWidth={3}`, explicit line-cap/join attributes |
| `buildOrdinaryShapeOutline` | Group `target`; ellipse center `(189, 21)`, radii `(21, 21)` | React group plus `<ellipse cx={189} cy={21} rx={21} ry={21}>`; authored circle already normalized by D2 |
| Native scene paint/stroke | Target fill `(77,171,247,255)`; stroke width `2` | Exact fill/stroke attributes, with no HTML-border box conversion |
| `buildConnection` / `connectionPath` | Group `(source -> target)[0]`; move `(59.5,21)`, line `(161,21)` | React path `d="M59.5 21 L161 21"` |
| `buildConnection` stroke | Purple `(123,44,191,255)`, width `4`, round caps/joins | `stroke="#7b2cbf"`, `strokeWidth={4}`, `strokeLinecap="round"`, `strokeLinejoin="round"`, no path fill |
| Native `arrowhead` | Diamond local path `M0 13.5 L16.5 3.375 L33 13.5 L16.5 24.3 Z`; white fill, purple stroke width `4` | Separate React `<path>` preserving its native paints |
| Native `arrowhead` transform | Affine matrix `(1,0,0,1,130.4,7.5)` on the destination arrowhead | `transform="matrix(1 0 0 1 130.4 7.5)"` on its React group/path |
| Native scene node order | Background → source → target → connection; line before arrowhead within the connection | Preserve child order in React; do not sort by DOM type |

The compiled route is `(56,21) → (168,21)`. Painting those raw endpoints would omit D2's stroke/arrowhead adjustments. The scene builder already supplies the adjusted line, marker geometry and transform, so React does not need to invent those calculations. Relevant upstream functions are in [shape_effects.go](../imports/d2/d2renderers/d2scenebuild/shape_effects.go) and [connection.go](../imports/d2/d2renderers/d2scenebuild/connection.go).

Color mapping is straight NRGBA to browser color plus alpha `A/255`; scene-node opacity is a separate compositing value. Future translucent cases must check that these are not multiplied twice. Path commands are typed absolute operations; converting them to SVG path syntax is serialization, not a new routing engine.

### Identity and serialization findings

- Top-level groups preserve `source`, `target` and the indexed connection ID. Source association for this case can use those groups and the target/graph; the derived arrowhead ID does not identify an independently authored object.
- Ordinary outline children can have empty IDs. React keys for these primitives need parent identity plus stable child position; do not require a new D2 ID on every primitive.
- Go scene primitives, paints, filters and assets are closed interfaces. Raw `encoding/json` output lacks concrete-type discriminators. The probe's separate pre-order type trace establishes which types were produced; it is diagnostic output, **not an approved public bridge schema**. A production bridge needs explicit variants and validation instead of property-name guessing or dependence on Go type-name strings.
- Scene construction is directly from D2's target model; this probe does not parse a finished SVG to reconstruct the diagram.

### Version evidence and limits

The official annotated `v0.9.0` tag resolves through tag object `30b2b7c32ddbc3faaaf6faab0f528f496034da7b` to commit `d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda`. The loaded `d2scenebuild/build.go` and `go.mod` were fetched from the official tag and compared byte-for-byte; both match. This verifies those two files, not the complete unversioned local tree. Immutable references: [builder](https://github.com/d2lang/d2/blob/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda/d2renderers/d2scenebuild/build.go), [scene model](https://github.com/d2lang/d2/blob/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda/d2renderers/d2scene/scene.go), [connection calculations](https://github.com/d2lang/d2/blob/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda/d2renderers/d2scenebuild/connection.go).

A separate installed-package probe returned D2 `v0.9.0`, JS `0.1.34`, and a target model exactly equal to the rebuilt probe's target for `geometry.d2`. This is fixture-specific behavioral agreement; it does not establish full binary/source or font correspondence. The test probe deliberately does not claim the prebuilt package exposes the native scene API.

Go's [documented WASM flow](https://go.dev/wiki/WebAssembly) supplies the compile target and matching `wasm_exec.js` runtime. The tests use the runtime from the same mise-managed Go installation that builds the module. Go dependencies are verified against the imported module's existing sums with `-mod=readonly` and cached only under root `.cache/`; probe output goes under `artifacts/scene-probe/`. No new dependencies or module files were added to the imported source.

This fixture has no visible text, external assets, gradients, effects or nested boards. Their WASM behavior, scene serialization and visual parity remain unverified. Next: define the smallest typed scene bridge for this proven subset and render these primitives with React, then run native-versus-React image comparison; characterize theme overrides using the existing fixture before extending palette support.

## React geometry adapter

The geometry mapping above now has a standalone React implementation in [GeometryScene.tsx](../research/geometry/GeometryScene.tsx), with its typed boundary and decoder in [geometry-scene.ts](../research/geometry/geometry-scene.ts). The native investigation helper adds an explicit `Kind` discriminator to each supported scene node, while retaining D2's field names, numbers, child order and paints. The original raw scene/type trace remains available for diagnosis. This is an experimental geometry contract, not an upstream or general scene API.

Supported variants are groups, rectangles, ellipses and paths containing move/line/close commands, with solid NRGBA paint. Transforms, node opacity, stroke width/caps/joins/dashes and viewport dimensions map to their corresponding native SVG attributes. Null paint maps to `none`; alpha maps to `A/255`. D2's zero miter-limit default maps to SVG's default `4`. No full SVG is embedded, and no route, shape or palette is reconstructed with CSS.

The Go exporter rejects unsupported primitive/paint/effect/asset/link data before emitting any result. The browser boundary validates type tags, geometry, byte-valued color channels, transforms, stroke values and path structure, with finite numbers and traversal/work limits. Unsupported data fails explicitly rather than disappearing or taking a generic fallback. The adapter does not treat D2 classes as CSS classes.

The test harness builds a local browser bundle and loads a native-generated scene fixture through React's [documented `createRoot` API](https://react.dev/reference/react-dom/client/createRoot). Direct browser-WASM-to-React wiring and a packaged library runtime API remain pending. The separate Chromium/WASM test establishes that the same fixture produces the same scene data in the browser. Root React/React DOM are pinned to `19.2.6`, matching the imported prototype; TypeScript/types are pinned, and [esbuild's build API](https://esbuild.github.io/api/#build) creates only the comparison bundle. `pnpm-workspace.yaml` records approval for esbuild's install script alone, using pnpm's [package-specific build approval](https://pnpm.io/cli/approve-builds).

### Geometry image and DOM proof

[react-geometry.spec.mjs](../tests/browser/react-geometry.spec.mjs) compares the React drawing with a fresh SVG produced by the native D2 CLI from the same `geometry.d2` input and matching TALA seed/theme/padding/scale options. The existing comparison helper checks drawing bounds and screenshots at the unchanged thresholds. The first focused run passed. Both captured images were visually inspected.

The browser test also checks the accessible diagram name, one SVG with two rectangles/one ellipse/two paths, no image or foreign-object substitute, the source stroke width, no console/page errors, and a React paint update that preserves the existing rectangle DOM element. `artifacts/scene-probe/react.png` retains the original comparison rendering before that update. Changing the fixture through the test harness is not a D2 source-editing implementation.

`mise run test:scene` builds the scene probe/reference/bundle and checks native/Node-WASM equality plus malformed/unsupported wire data. `mise run typecheck` checks the standalone TypeScript. Root `check` includes both and the React browser comparison in the same Playwright invocation as the existing tests, preserving output/report isolation. The full `D2_WEB_OUTPUT` corpus integration remains pending; this proof covers one geometry fixture.

## Handoff

### React geometry slice: 30 October 2026

Continued the approved geometry mapping with a small typed React adapter, explicit native type tags, fail-closed admission, a local comparison bundle and a real native-versus-React image/DOM test. Added source files under `src/`, renderer TypeScript configuration, root React/build dependencies with exact versions, their lockfile entries, and esbuild's package-specific build permission. Updated the existing scene probe/tests and root mise gates. Both imported source trees remain preserved and Studio remains clean. Nothing was staged, committed, pushed or published.

Focused TypeScript, native/Node-WASM, decoder, frozen-install and Chromium React comparison checks passed. The new browser test first failed because the reference/candidate files did not exist, then passed with real React output. Final `mise run check` passed four infrastructure tests, four native cases, one native/Node-WASM case, two decoder tests, four Chromium tests, strict renderer typechecking and 20 task definitions. Go formatting, documentation links/whitespace and reference Studio cleanliness checks passed. Self-review checked type-tag admission, paint/coordinate preservation, unsupported features, alpha/group semantics and DOM identity; the review also fixed zero-sized viewport admission, empty-array handling and primitive-key collisions. No screenshot thresholds or existing assertions were weakened.

The user clarified that d2web is a reusable library and Studio is a future consumer. That scope now governs the brief, README, map and agent guidance. This slice delivers a library component and conformance fixture; editor UI and application state belong to consumers. Text/fonts, gradients, effects, images, boards and source operations remain outside its verified subset. Next characterize the theme override fixture and typed paint handling; browser compiler-to-React wiring and general corpus output are separate library tasks.

### Geometry probe: 30 October 2026

Accepted scope was to continue the native-scene investigation using `geometry.d2`, preserving imported source and the agreed HTML/React-owned SVG direction. Added a Go probe, Node assertion test, Chromium assertion test and a root `test:scene` mise task. `test:comparison` now waits for native/WASM scene generation and runs the new browser test in the same Playwright invocation as the existing comparison self-tests, avoiding concurrent report/output writers. Root `check` therefore includes the new boundary proof; CI uses the existing root check.

Focused native/Node-WASM and Chromium-WASM tests passed. The installed-package target equality and official tag/two-file verification also passed as one-off probes. The first new assertion run failed before the helper existed; execution then exposed the missing D2 context logger, which was fixed using the native logger API. The initial Go build needed permitted network access for pinned module downloads into the workspace cache. No renderer, prototype source, source-editing behavior, upstream repository or deployment was changed. Nothing was staged or committed.

Final verification: `mise run check` passed four unit tests, four fast native TALA runs, one native/Node-WASM scene test, three Chromium tests and all 19 mise task definitions. Changed-document link/whitespace checks passed; `gofmt -l tests/scene-probe.go` returned no files. Chromium used the permitted execution outside the macOS sandbox. Self-review checked process failures/timeouts, output isolation, native source preservation and the distinction between diagnostic serialization and a public API. No checks or image thresholds were relaxed. The full 147-run corpus and failing imported-app lint gate were not rerun because neither input set nor application code changed.

### Example assessment: 30 October 2026

The local examples are sufficient to start characterizing the mapping without inventing a new broad fixture. Inventory verification found 79 standalone file examples, 50 extracted SVG-oriented archive inputs and 14 extracted ASCII-oriented inputs. Together with the fast chess/import/board runs, the existing selector registers 147 runs. Saved native corpus records show 145 successful runs; Twitter and WCC fail while bundling remote images. These records were inspected, not regenerated during this assessment.

The loaded Go source also contains an existing candidate for the missing paint boundary: [d2scenebuild.Build](../imports/d2/d2renderers/d2scenebuild/build.go) converts the typed D2 target into a [d2scene.Document](../imports/d2/d2renderers/d2scene/scene.go), used by native raster rendering. Its [primitive model](../imports/d2/d2renderers/d2scene/primitive.go) includes rectangles, ellipses, paths, text runs and images; scene nodes carry transforms, opacity, blend, clips, masks, filters and children. The builder accepts native theme overrides and resolves geometry and assets. This is a stronger reuse candidate than reconstructing appearance from target fields in React.

Source inspection found no scene export in the loaded public JS declarations, JS wrapper or WASM functions. Investigate whether this builder and its asset/font dependencies can compile and operate in WASM, how to serialize its typed primitives and how to retain semantic/source identity for editing. Native raster-scene suitability does not establish browser DOM parity. The local source snapshot has no `.git` metadata, so the revision in import provenance remains a recorded claim rather than a live Git check; pin or verify its contents before tying this scene path to the installed package.

Use this sequence of existing inputs to establish specific contracts:

| Input | What to establish |
| --- | --- |
| [geometry.d2](../examples/files/geometry.d2) | First slice: rectangle, circle, exact sizes/colors/stroke widths, routed connection and diamond arrowhead |
| [theme-overrides.d2](../examples/archives/txtar/theme-overrides.d2) | Base palette versus override application, container colors, multiple outlines, structured tables and dark override data |
| [gradient.d2](../examples/archives/txtar/gradient.d2) | D2 gradient strings to browser paint definitions, including font paint and label fill |
| [border-label.d2](../examples/archives/txtar/border-label.d2), [label_positions.d2](../examples/files/label_positions.d2) | Shape outlines, label geometry, border masking and outside bounds |
| [arrowhead_scaling.d2](../examples/files/arrowhead_scaling.d2), [cross_arrowhead.d2](../examples/files/cross_arrowhead.d2) | Arrowhead variants and stroke-dependent geometry |
| [multiple_offset.d2](../examples/files/multiple_offset.d2), [border-container.d2](../examples/archives/txtar/border-container.d2) | Effect geometry, nested offsets and border behavior |
| [all_shapes_link.d2](../examples/files/all_shapes_link.d2) | Shape/link/tooltip combinations and class composition; its name does not prove all 25 registered shapes are present |
| [code_font_size.d2](../examples/files/code_font_size.d2), [md-tables.d2](../examples/archives/txtar/md-tables.d2), [grid_with_latex.d2](../examples/files/grid_with_latex.d2) | Rich-content layout and text metrics |
| [multiline-class-headers.d2](../examples/archives/txtar/multiline-class-headers.d2), [sql-table-reserved.d2](../examples/archives/txtar/sql-table-reserved.d2) | Structured row/header rendering and identifiers |
| [imports workspace](../examples/imports/main.d2), [boards workspace](../examples/boards/main.d2), [model-view.d2](../examples/archives/txtar/model-view.d2) | File ownership, board selection, inheritance, glob filtering and suspension |
| [nested_diagram_types.d2](../examples/files/nested_diagram_types.d2), [sequence-multiline-alignment.d2](../examples/archives/txtar/sequence-multiline-alignment.d2) | Specialized/nested layout and sequence geometry |

Four inputs were compiled successfully through the installed package's **Node/WASM** path: geometry, theme overrides, border labels and gradients. This is a compile-data probe, not browser or React parity. Geometry produced two shapes and one connection, with the authored source stroke width `3`, connection width `4` and diamond arrowhead preserved. Theme overrides produced 13 shapes/14 connections; border labels 18 shapes; gradients two shapes/one connection.

Important observed boundaries:

- Actual responses contain `graph.theme` with palette and special-rule data, despite weak public typing. Shape colors can remain symbolic (`B1`, `AB4`).
- The theme example returns base `graph.theme.colors.b1 = #0D32B2`, while the requested `#2E7D32` is held separately in `renderOptions.themeOverrides.b1`. Copying the graph palette alone would be incorrect. Reuse the native theme override operation and test the full effective paint resolution.
- The inspected shape/connection objects expose bounds, paints, route points and label-position names, but no ready-to-use `path` or `d` field. Native geometry/render helpers must still be traced; this does not prove that every missing datum requires a new bridge.
- The gradient example preserves D2 gradient expressions in fill/stroke strings, so `CSS.supports('color', value)` followed by a generic fallback would discard valid D2 paint.
- No explicit `style.italic` or `text-transform` declarations were found in the copied `.d2` corpus. Rich Markdown italic text does exist. Native Go-defined cases in `imports/d2/e2etests/stable_test.go`, `themes_test.go` and `d2compiler/compile_test.go` provide cases to adapt into `examples/` when those capabilities are implemented.
- `artifacts/web/` does not yet exist and actual React scene generation is not connected to parity. Comparison self-tests exercise the harness only.

Verification in this assessment: `mise run test:unit` passed all four tests; one-off WASM probes passed the four examples plus focused geometry assertions. `mise run check` passed four unit tests, four fast native TALA runs, two browser comparison self-tests, task validation and tracked/staged whitespace checks. Chromium initially failed sandbox Mach-port registration; the permitted rerun outside the sandbox passed without changing flags or thresholds. The porting-map link/whitespace check passed and the imported Studio checkout remains clean. No application changes, full-corpus rerun or native/React comparison was performed. The next bounded task is to evaluate the existing native scene builder against the geometry example, verify its source/runtime and WASM boundary, and map its primitives to React DOM. Theme override resolution follows using the existing theme fixture.

### Earlier design-map handoff

Accepted requirements: React-owned HTML/SVG DOM; direct, traceable D2 styling/theming; a complete porting map before renderer expansion; direction toward D2 toolchain participation. Proposed details: module/component boundaries, native geometry/paint bridge, DOM topology and upstream contribution sequence.

This pass changed documentation only. The imported prototype and its repository are unchanged. Web source inspection confirmed registry/model/renderer boundaries; no native/browser parity cases, renderer implementation, bridge build or upstream communication occurred. Next task: pin the source-to-runtime baseline, then run the representative mapping experiment above. Changes remain uncommitted.

Verification: `mise run check` passed (tool versions, task validation and tracked/staged whitespace). A separate Python documentation check passed for local Markdown links, whitespace in the four changed Markdown files, exactly one mapping row per style keyword, presence of all 25 shape names and a clean imported checkout. Those checks validate documentation coverage, not renderer correctness.
