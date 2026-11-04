# Specifications

The accepted product scope is [read-only v1](product.md); [ADRs](adr/README.md) own architecture decisions. These contracts have implementations, but acceptance of a spec does not certify every feature combination. Current browser defects, evidence and verification limits are in the [web-native audit](web-native-audit.md).

| Spec | Status and implementation |
| --- | --- |
| [0001 Compile protocol and scene bridge](specs/0001-compile-protocol.md) | Accepted; worker, host client, request validation and closed scene encoding |
| [0002 Mount API](specs/0002-mount-api.md) | Accepted; mount/update/dispose, events and consumer content; ownership and lifecycle regressions covered |
| [0003 Packaging](specs/0003-packaging.md) | Accepted; build artifacts, size budgets and consumer checks; registry publishing is separate |
| [0004 Association](specs/0004-association.md) | Accepted; per-board objects, source ranges and lookup helpers |
| [0005 Animation](specs/0005-animation.md) | Accepted; Web Animations mapping; animated objects preserve their HTML ownership frame |
| [0006 Accessibility](specs/0006-accessibility.md) | Accepted; names, descriptions and ownership attributes; screen-reader use remains unverified |
| [0007 Fonts and text](specs/0007-fonts-and-text.md) | Accepted; consumer fonts, script fixtures and opt-in patched emoji support |
| [0008 Large boards](specs/0008-large-boards.md) | Accepted; explicit engines, layout timeout and measured limits |
| [0009 Semantic content](specs/0009-semantic-content.md) | Proposed contract with user-authorized staged implementation; positioned semantics and opt-in markdown flow |
| [0010 Images](specs/0010-images.md) | Accepted; supplied/bundled bytes, linked images and unresolved-image diagnostics |

| [0011 Rendering contract](specs/0011-rendering-contract.md) | User-authorized implementation; typed prepared boards and explicit native/consumer DOM ownership; React renderer not built |
| [0012 Edit API](specs/0012-edit-api.md) | Accepted (ADR 0012); built: worker `edit`, `client.edit`, equivalence gate, label guard, override warnings; protocol version 2; section 7 questions 2, 5, 6 open |
| [0013 d2editor, first slice](specs/0013-d2editor.md) | Accepted; built in `packages/d2editor` and verified in Chromium; published at `/editor/` on GitHub Pages once merged to `main` |
| [0014 d2editor, drag to position](specs/0014-drag-to-position.md) | Accepted and built 3 November 2026; `test:editor` in Chromium |
| [0015 d2editor, palette, zones and drag-to-connect](specs/0015-palette.md) | Accepted 3 November 2026; building |
| [0016 d2editor, drag past the origin](specs/0016-drag-past-origin.md) | Accepted and built 3 November 2026; `test:editor` in Chromium |
| [0018 d2editor, element kinds and the layered inspector](specs/0018-element-kinds.md) | Accepted 4 November 2026 with ADR 0015; slice 1 built (`tasks/todo-0018.md`), slices 2-5 not; `test:editor` in Chromium |
| [0019 edit API, structure operations](specs/0019-structure-edit-ops.md) | Accepted 4 November 2026; not built |

Research probes under `research/` are evidence, not additional production APIs. The generated [feature map](feature-map.md) covers catalog constructs and paint measurements; it is not full semantic or browser acceptance.
