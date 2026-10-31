# Spec 0002: mount API (painted board in a host element)

Status: **accepted** (user, 31 October 2026, with the three recommendations of section 8). Builds on [spec 0001](0001-compile-protocol.md) (compile protocol) and [ADR 0003](../adr/0003-runtime-shape.md) (shadow-root host, consumer-owned content). Scope per [product.md](../product.md): v1, read-only render. Nothing here exists as an API; the research it rests on is named in section 8.

## 1. Purpose and non-goals

`mount` takes a successful compile result and paints one board into a consumer-provided element, isolated from the page's CSS, with D2 identity on events and the option to replace a node's painted content with a consumer element. It does not compile (that is the spec 0001 client), edit source, lay out consumer content (D2 owns layout; the consumer feeds measured sizes back as D2 `width`/`height` in its own source), or provide zoom/pan, selection, toolbars or application state.

Not in this spec: animation painting (unpainted in v1), editing and undo (v2), React binding, browsers other than Chromium, non-root board navigation UI (a consumer mounts the board it wants).

## 2. Surface

```ts
mount(host: HTMLElement, options?: MountOptions): Mount

interface MountOptions {
  idPrefix?: string;              // default: unique per mount ("d2w1-", "d2w2-", ...)
  a11y?: boolean;                 // default true: named focusable groups per D2 object
  fonts?: 'register' | 'consumer'; // default 'register' (open question 1)
}

interface Mount {
  update(result: CompileResult, board?: string): Promise<UpdateReport>; // board defaults to the root board ''; async because fonts must be loaded before text baselines are measured
  nodeBox(id: string): Box | undefined;                         // scene coordinates of a painted object, after update
  setNodeContent(id: string, element: HTMLElement | null): void; // null restores the faithful default
  on(type: D2EventType, listener: (event: D2Event) => void): () => void; // returns the unsubscribe function
  dispose(): void;
}

interface UpdateReport { board: string; orphaned: string[] } // consumer content whose node is gone
type D2EventType = 'click' | 'dblclick' | 'contextmenu' | 'hover' | 'focus';
interface D2Event { type: D2EventType; board: string; id: string; domEvent: Event }
```

## 3. Lifecycle

_Amendment (31 October 2026, found while building step 2): `update` is asynchronous. Result fonts must finish loading before the painter's text baselines are measured, and `FontFace.load()` is a promise. Everything that can throw still happens before the DOM swap, and the swap plus baseline calibration run synchronously after the fonts._

- **mount** attaches an open shadow root to `host` and puts one wrapper inside it styled `all: initial; display: block; visibility: inherit`. It adds nothing else to the document: no network request, no global, no head or stylesheet change, no storage (except fonts, section 6). The library never styles `host`; the consumer positions and sizes it.
- **update** paints first and swaps afterwards: any throw (invalid or errored result, unknown board, unknown primitive, null `Root`, missing `ViewBox`) leaves the previous DOM untouched. A result with an `error`, or without the requested board, throws `MountError`. Success replaces the board's DOM wholesale and re-applies consumer content (section 5).
- **dispose** removes all nodes, listeners and font registrations this mount added, and detaches the shadow root contents. A disposed mount throws on use. Remounting the same host with the same result reproduces identical markup.
- Two mounts may exist on one page, including the same scene twice; IDs inside a mount are prefixed, so painted gradients, masks and clips cannot collide.

## 4. Events

Listeners are delegated on the mount's wrapper. A listener receives the D2 object the event happened on (the nearest painted group that carries a D2 ID), not a DOM element. `hover` fires on enter and leave of an object (`domEvent.type` distinguishes). `focus` fires when a named group receives focus. Events inside consumer-supplied content (section 5) are the consumer's own: they bubble to the node's group and are reported like any other event for that node unless the consumer stops them.

## 5. Consumer content

`setNodeContent(id, element)` removes the painted shape and label children of the node's group and inserts `element` at the node's box, absolutely positioned, sized to the box; the group, its ID and all other objects remain. `null` restores the removed children byte-for-byte. Registrations persist across `update`: after each update the content is re-applied to nodes that still exist, and ids that no longer exist are listed in `UpdateReport.orphaned` (the registration stays so a later update may revive it). The consumer owns the element: the library never reads, clones or styles its contents. Routes are not recomputed; to change a node's size the consumer sets `id.width` and `id.height` in its source and recompiles with the spec 0001 client, then calls `update`. Containers and edge labels follow ADR 0003 (frames adapt to the returned box; edge labels use transparent placeholders). Content that overflows its box is clipped by the board's root.

## 6. Fonts

Compile results carry the font bytes D2 used (spec 0001 section 3.3). With `fonts: 'register'` the mount registers them in `document.fonts` under painter-derived family names, shared and reference-counted across mounts and released on dispose. With `'consumer'` the mount registers nothing and the consumer must have registered those family names itself. Missing fonts are reported by the font contract (ADR 0006), not here.

## 7. Verified, proposed, unknown

| Claim | State | Evidence |
| --- | --- | --- |
| Shadow root plus `all:initial` wrapper paints identically under hostile page CSS; ID collisions removed by prefixing | verified (research painter, two board pairs) | `test:research:lifecycle` |
| Update with a throwing paint leaves the previous DOM; dispose removes everything; remount reproduces markup | verified (research painter) | `test:research:lifecycle` |
| Node content replacement leaves the rest of the board unchanged; restore is byte-identical; consumer receives clicks | verified (research, chess board) | `test:research:content` |
| Named focusable groups per D2 object, Tab order = paint order | verified | `test:research:a11y` |
| Measured card sizes become D2 width/height and converge in one recompile | verified | `test:research:loop`, `test:research:shadcn` |
| Product mount API: mount, update (paint then swap), nodeBox, dispose, remount, a live mount cannot be mounted over | verified in Chromium | `test:client` (`mount.spec.mjs`) |
| Events with D2 identity for nodes and connections, hover enter/leave, focus, unsubscribe; linked objects keep their identity | verified in Chromium | `events.spec.mjs` |
| Consumer content: restore byte-identical, persistence across updates, `orphaned`, measured-size handshake | verified in Chromium | `content.spec.mjs` |
| Same scene mounted twice; hostile page CSS; hidden host stays hidden | verified (pixel-identical to a clean baseline) | `mount.spec.mjs` |
| Links and keyboard focus under the shadow root | verified (focusable, hit-testable; navigation itself not exercised) | `events.spec.mjs` |
| Font registration shared and reference-counted across mounts; `'consumer'` registers nothing | verified | `fonts.spec.mjs` |
| Source to pixels through client and mount, light and dark within 5% of native D2 | verified on one board | `fonts.spec.mjs` |
| `nodeBox` for path shapes is the bounds of the outline's points (control points included), not the exact outline | known approximation | `mount.ts` |
| Animation painting, other browsers, screen readers, find-in-page | unknown / not built | |

## 8. Decisions taken in review (user, 31 October 2026)

1. Fonts: the mount registers result fonts in `document.fonts` by default (shared, reference-counted, released on dispose); `fonts: 'consumer'` opts out.
2. Accessibility: named focusable groups are on by default.
3. Shadow root mode: open.

The user accepted the spec as written on 31 October 2026.
