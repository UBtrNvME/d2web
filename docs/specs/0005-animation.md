# Spec 0005: animation painting

Status: **accepted with the recommended answers to questions 1-3** (user, 31 October 2026). Builds on [spec 0002](0002-mount-api.md), which lists animation painting as unpainted in v1, and on [ADR 0009](../adr/0009-natural-web-forms.md): D2 owns the semantics, d2web translates them to the web and adds no behaviour of its own.

## 1. What D2 provides

The scene carries typed tracks on nodes (`d2scene.Node.Animations`, `imports/d2/d2renderers/d2scene/animation.go`). A track has a property, delay, duration, `Repeat` (loops forever) and keyframes with offsets, values and easing. The scene builder emits tracks for three D2 features (checked in `d2scenebuild`):
- `style.animated` on a connection: a linear, repeating `stroke-dashoffset` track (a bidirectional connection is split in two with opposite directions);
- `style.animated` on a shape: repeating transform and two drop-shadow tracks (`shape_effects.go`);
- the legend's animated entry (`legend.go`).

Today the painter draws all of these at their first frame. The feature map case `animation/animated-edges` is therefore ok at t=0, which says nothing about motion.

## 2. Proposal

Translate each track to the Web Animations API, one call per track on the element the track belongs to, with no extra timing or policy:

| Scene | Web |
| --- | --- |
| `Delay`, `Duration` | `delay`, `duration` (ms) |
| `Repeat` | `iterations: Infinity`; otherwise 1 |
| keyframe `Offset`, `Value` | keyframe `offset` and the CSS property below |
| `Easing` linear, cubic-bezier, step-start, step-end | `linear`, `cubic-bezier(x1,y1,x2,y2)`, `steps(1, start)`, `steps(1, end)` |
| `AnimateOpacity` | `opacity` |
| `AnimateTransform` | `transform: matrix(...)` |
| `AnimateStrokeDashOffset` | `stroke-dashoffset` on the painted path |
| `AnimateFillColor`, `AnimateStrokeColor` | `fill`, `stroke` |
| `AnimateDropShadow` (indexed) | `filter: drop-shadow(...)` for that entry |

- Tracks start when the board is painted by `update` and stop when it is replaced or the mount is disposed (animations belong to the removed DOM).
- Each track fills `both`, so the first and last keyframes hold during delay and after the end; this is the scene's documented behaviour ("renderers resolve tracks without changing the track").
- No new `mount` option or method. Because they are ordinary Web Animations, a consumer can pause or cancel them with `host.shadowRoot.getAnimations()`, and can stop them with CSS in its own page only through that API; we ship no pause button, no frame-rate cap and no motion policy.
- The painter already puts animated subtrees on the SVG path (`inEffect`); a track on an element inside it targets the SVG element, which accepts the same CSS properties.

## 3. Test plan (proposed)

1. Unit: a pure function maps a track to `{keyframes, options}`; every property, easing and the repeat flag are table-tested without a browser.
2. Browser: `animated-edges` and an animated shape produce the expected number of running animations (`getAnimations()`), none for a board without animation, and none after `dispose`.
3. Frame comparison: pause the page's animations and native D2's at the same `currentTime` (for example 250 ms and 750 ms) and run the existing pixel and ink comparison, so motion is checked, not only the first frame.
4. Replacing the board cancels the old animations (no leak).

## 4. Open questions for the user

1. **Reduced motion.** Recommended: no automatic handling, because it would be policy on top of D2's semantics (ADR 0009); the consumer can add it with `getAnimations()` or a stylesheet in its own page. Alternative: honour `prefers-reduced-motion` by default and say so in the docs. Which?
2. **An opt-out option.** Recommended: none in v1 (see the point above). Alternative: `animate?: boolean` on `MountOptions`, default true.
3. **Scope.** Recommended: connection and shape animation only; `--animate-interval` (stepping through boards as a GIF/SVG export) stays out, since boards are mounted by the consumer's navigation.

## 5. Verified, proposed, unknown

| Claim | State |
| --- | --- |
| Which D2 features emit tracks | verified in `d2scenebuild` source |
| The painter ignores tracks today | verified (spec 0002, `paint.js`) |
| Every track property and easing has a direct CSS/WAAPI form | proposed; the drop-shadow track and bidirectional split are not yet exercised |
| Native and web match at equal `currentTime` | unknown until step 3 of the test plan runs |
| Firefox and Safari | animation suite passes in Firefox and in WebKit with the wasm on the page thread; Safari is unsupported for now (docs/browser-support.md) |
