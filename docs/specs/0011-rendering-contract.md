# Spec 0011: prepared boards and DOM ownership

Status: user-authorized implementation (2 November 2026). Extends [0001](0001-compile-protocol.md) and [0002](0002-mount-api.md) under [ADR 0009](../adr/0009-natural-web-forms.md). This records the rendering boundary requested after the browser bug fixes; it does not select a React implementation.
Delivered: not audited item by item (4 November 2026). A spec is a short-lived brief: it must end `delivered` (or be marked not delivered); an agent that finds it otherwise tells the user. (Audited 4 November 2026.)

## Renderer input

```ts
const board = prepareBoard(result, '/layers/detail'); // '' selects the root
```

`prepareBoard` runs without a DOM, font loading, fetching or layout. It rejects errored results, missing boards and scenes without `Root`/`ViewBox`. It returns a `RenderBoard` containing:

| Field | Meaning |
| --- | --- |
| `revision`, `path` | Compile revision and selected board; object identity is scoped to these plus object ID |
| `scene` | Complete `SceneDocument` from the worker, including primitives, paint, transforms, clips, masks, filters, animation tracks, assets and link regions |
| `association` | Complete source association, labels, content roles, hierarchy, endpoints and image policy from that board |
| `fonts` | Font bytes from the compile result, keyed by scene asset ID |
| `objects` | Association objects with optional `bounds`: the worker's `box` (spec 0004), D2's own box for a shape, the `mount.nodeBox()` value |
| `links` | Scene regions with the `objectId` D2 added them for (association `links`); the same owners native paint uses |

The public scene types in `src/scene.ts` describe scene encoding v1, pinned to the Go encoder and D2 v0.9.0. Primitives, paints, assets and filters are closed tagged unions. D2 field names and numeric enums are preserved; coordinates are logical scene pixels and track durations are nanoseconds. Struct tags and any future extra fields remain in the borrowed data. This is D2's scene, not a second diagram model or a virtual DOM.

Scenes and resources are borrowed, not cloned or frozen. Renderers must treat them as immutable, including the existing association records and font buffers. TypeScript marks scene fields and prepared collections readonly; this is not runtime validation of arbitrary third-party JSON. The existing versioned worker protocol remains the trust boundary. A renderer must implement unsupported kinds explicitly or fail visibly; it must not silently drop them.

`bounds` is D2's box for a shape: the position, width and height D2 laid out (`d2target.Shape`), the box D2 sizes from a measured width/height, whatever paints it (curves, a `multiple` back card, a shadow or blend group). For a connection it is the exact geometry bounds of the paths it paints (route, both halves of an animated two-way route, arrowheads; D2's `Path.GeometryBounds`, curve extrema included). Labels outside the shape, strokes and effects are not in it. Link owners come from D2's region order (spec 0004). A board without these fields (hand-built input) falls back to exact rectangles and ellipses and no box for paths; a link region without a D2 owner stays unowned (the old smallest-containing-object estimate is removed).

## Native renderer and mount

`src/dom.ts` owns native markup, the element-to-D2 identity map, default paint fragments, baseline calibration, flow-fit measurements, native copy/tooltip handlers and Web Animation targets/cancellation. These details are internal. `mount.ts` owns the shadow-root host, delegated event delivery, shared font acquisition/release and content registrations. It passes a prepared board to the renderer; it does not query paint markers, infer primitive bounds or pick animation children.

Each update prepares a detached default view before replacing the previous one. Invalid input or a painting error leaves the previous view intact. After fonts are ready, attachment measures text in local coordinates, including ancestor scale and D2 render scale. The caller must await updates on the same mount; this slice adds no scheduling policy for overlapping updates. Updating recreates native frames and restarts their animations; focus retention across replacement is not promised.

## DOM ownership

| Owner | Boundary and responsibility |
| --- | --- |
| Consumer | Host element and its placement; supplied content root, descendants, local state and event handlers |
| Mount | Its shadow-root contents, wrapper, delegated D2 listeners and registration lifetime |
| Native renderer | Object frames, all faithful paint children, positioning holders, baseline probes, animation bindings and internal identity map |

Native copy and tooltip handlers operate only on elements captured from faithful paint; consumer code blocks and tooltips keep their own behaviour. The open shadow root supports inspection; its paint nodes and attributes are not an API to mutate. A consumer attaches custom content through `setNodeContent(id, element)` and supplies its own styles within the shadow boundary. The renderer moves that exact root into a holder at the object's box and never clones, rewrites or styles its descendants. Root/child identity, state and listeners survive updates. D2 events derive from renderer-owned frames, so a consumer's own `data-id` cannot impersonate another object. This binding works with `a11y: false` too.

A root may belong to one object on one mount at a time. Re-registering the same root to the same slot is harmless. Sharing a registered root, nesting registered roots, or taking paint nodes from another mount throws before the current registration changes. Registering the host or an ancestor that would create a cycle also fails. Clear the original registration before transferring a root to another slot.

`setNodeContent(id, null)` detaches the consumer root and restores the saved default children. Replacing a registration detaches its old root. Missing objects are reported as `orphaned`; their root is detached and their registration remains until cleared, disposed or revived by a later update. Disposal cancels native animations, detaches consumer roots, releases their registrations and removes the mount's listeners, wrapper and font references. The consumer remains responsible for its framework roots, effects and application resources.

The animation fallback keeps a named HTML object frame around its SVG paint, so content replacement, focus and events use the same ownership boundary as other objects. Custom content replaces faithful appearance; it does not inherit every D2 paint effect. Size changes still require explicit D2 width/height and recompilation.

## Future framework renderers

A full React renderer can consume `RenderBoard` and own its entire React-created tree, including nodes, labels and connections. It must implement the same D2 paint/semantic rules, resources, events and disposal, with its own DOM measurements. It must not reconcile children owned by the native `mount`. An adapter using the existing native mount instead owns an outer host or a registered content root. These are distinct integration paths; neither requires a custom virtual DOM in the core.

This slice supplies typed renderer input and isolates the native implementation. It does not implement a React renderer, renderer registration API, automatic reflow/layout, or a semantic component schema beyond the existing association and scene.

## Verification and handoff

- `render.test.mjs`: DOM-free preparation, board selection, identity/association preservation, frozen-input immutability and error paths.
- `content.spec.mjs`: root/state/listener preservation, event identity despite consumer attributes, rejected ownership transfers, restoration and disposal.
- `regressions.spec.mjs`: repeated scaled updates, animated object boundary, pending/concurrent font cleanup and distinct inline-link names.
- Existing mount, event, semantic, animation, packaging and native-comparison gates retain their assertions and tolerances. Exact integrated results are recorded in [the task ledger](../../tasks/todo.md).

Next: implement and compare a bounded React renderer against this input, if requested. Screen-reader use, real Safari and complete semantic coverage remain separate acceptance work.
