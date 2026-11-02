# Writing D2 that lays out well

Rules for writing D2 source that lays out cleanly on all three engines D2 ships with: TALA, ELK and dagre. A diagram that follows them compiles on every engine and keeps its labels clear on every engine, so it does not need changing when the engine changes. The rules come from rendering the large real-world examples in `examples/files/` and the demo examples with D2 v0.9.0 (2 November 2026), and finding out why they look bad. This is advice for people who write diagrams. It does not change d2web, which renders whatever D2 produces.

## Why big diagrams look bad

A layout engine places boxes and routes the lines between them. The engine is not the main problem. The usual causes are the source:

| Example | Size | What goes wrong | Cause in the source |
| --- | --- | --- | --- |
| `tpmjs_architecture.d2` | ~150 shapes, 58 edges, 4 levels of nesting | Lines run across the whole canvas; the database container is huge and mostly empty. ELK gives a tidier result, but it is still unreadable | One board tries to show everything at once: endpoints, flows, the database schema and pipelines. Edges go from deep leaves to deep leaves in other containers |
| `jupyter_aws_eks.d2` | 24 fixed `width`/`height` values, `grid-columns` | Large empty areas, and an edge crosses three containers to reach `API Server` | Fixed sizes override the engine's sizing, and edges go into grid cells |
| `lion_reader_frontend.d2` | 35 inline `style.` values, a hand-built "Legend" container | The legend floats under the diagram as a column of boxes, and colours are repeated by hand on each edge | Legend drawn as ordinary shapes instead of `vars.d2-legend`, with no `classes` |
| `ross_overview.d2`, `lion_reader_frontend.d2` | 23 tooltips and 13 links | A numbered appendix twice the height of the diagram | Tooltips and links have nowhere to go in a static export, so D2 adds them as footnotes. On the web they are interactive and need no appendix |

The demo examples in `packages/d2web/demo/index.html` have the same problems on a smaller scale:

| Demo | What goes wrong | Cause in the source |
| --- | --- | --- |
| URL shortener on AWS | Lines run through the labels of `redirect`, `CloudFront` and `bulk-import` (TALA and dagre). The `bulk-import` icon covers the `create` label | Every service is `shape: image` at a fixed 64×64 size with a two-line label. The label sits outside the image, so the engine neither leaves room for it nor routes around it |
| URL shortener on AWS | Long lines loop back across the diagram to Visitor | `fns.redirect -> user` and `fns.presign -> user` are replies drawn as separate edges, which turns each request into a cycle |
| URL shortener on AWS | The title moves around between layouts (top in one, bottom-left in another) | The title is an ordinary shape with no `near`, so the engine places it like any other node |
| d2web in the D2 ecosystem | Large empty areas; `run` and `preflight` cross the canvas; the `Demo app` and `Playwright conformance` labels are crossed by lines | Three levels of nesting, edges into children of children, `shape: image` labels as above, and icon-only nodes (TS, CSS, HTML5, gopher) used as decoration |

## Rules

### Structure

1. **Put one idea on each board.** A board that answers one question ("how does a request reach the executor?") lays out well. Aim for about 30 shapes or fewer per board. TALA's cost grows quickly: with one seed, 50 shapes take about 2.6 s and 100 take about 24 s in d2web ([layout-limits.md](layout-limits.md)). Like `d2`, d2web lays the diagram out once per seed (1, 2 and 3 by default) and keeps the best, so expect up to three times that; a consumer may request `seeds: [1]` while the user is editing ([spec 0001](specs/0001-compile-protocol.md)).
2. **Use an overview plus detail boards, not one giant board.** Put the overview at the root and each subsystem in `layers`. Use `link: layers.x` so readers can click from an overview node to its detail board. Use `scenarios` for variants of the same diagram and `steps` for a sequence that builds up. Do not cram all of these into nested containers.
3. **Keep nesting to two levels.** Every container level adds padding and makes edges that cross containers longer. A third level is usually a sign that the content belongs on a detail board.
4. **Connect at the level the reader cares about.** On an overview, connect containers (`api -> db`), not leaves (`api.discovery -> database.packages_group.Tool`). An edge from leaf to leaf across containers makes the engine route around every ancestor between them.
5. **Show lists as text, not as boxes.** A container holding eight unconnected boxes such as `GET /api/tools` is a list. Write it as one shape with a Markdown label (`|md ... |`) or as an `sql_table`. Unconnected leaves still cost layout effort and canvas space.
6. **Draw database schemas as `sql_table`.** Use `sql_table` and connect columns (`users.id -> posts.author_id`) instead of a container of boxes per table.
7. **Draw ordered interactions as `shape: sequence_diagram`.** Do not draw a numbered `step1 -> step2 -> ...` chain inside a container. D2 lays out sequence diagrams itself, the same way on every engine.

### Layout hints

8. **Set `direction` once, at the root.** Use `right` for pipelines and request paths and `down` for hierarchies. Only TALA honours a different `direction` on a container; ELK and dagre lay the container out in the root's direction. If part of the diagram needs another direction, put it on its own board. Prefer `right` when edges go from one container into another: ELK places a container's title inside its top edge, and edges arriving from above run straight through it. `direction: right` (edges enter from the side) or `label.near: bottom-center` on the container avoids that.
9. **Do not set `width`/`height` on containers. On other shapes, use them only for a deliberate size**, such as making nodes in a row the same size. Container sizes do not compile on dagre ("layout engine "dagre" does not support dimensions"). Fixed sizes also override the engine's sizing and leave empty areas (jupyter).
10. **Use `grid-rows`/`grid-columns` for layouts that are really tables**, such as a matrix of regions or a palette of components. Do not use them for shapes that have many edges. D2 lays out grids itself, the same way on every engine, and draws edges between cells of the same grid as straight lines that are not routed around other shapes (`d2layouts/d2grid/layout.go`).
11. **Use `near` only at the root, with a fixed position** (`top-center`, `bottom-right`, ...) for a title, a caption or a legend. Never use `near` to another object, or `top`/`left`. They work only in TALA; ELK and dagre refuse to compile them ("only supports constant values for near", "does not support locked positions").
12. **Look at the diagram on every engine you might use.** A diagram written to these rules renders on all three. ELK spreads wide graphs out more and dagre draws curved edges, but no labels should be crossed on any of them. If the layout is acceptable on only one engine, the board is usually too big (rule 1).

### Edges

13. **Avoid parallel edges.** Three edges from `clients.*` to `gateway.auth` say the same thing as one edge from `clients` to `gateway`. Combine them, or move the detail to a board where it matters. Likewise, do not add a container-level edge (`diners -> restaurants: eat at`) next to edges between the same containers' children: it repeats them and adds a line to route.
14. **A label on a chain applies to every edge in it.** `a -> b -> c: calls` labels both edges. Put a label on a chain only when every edge should carry it. Otherwise write the labelled edge on its own line.
15. **Keep edge labels short (one to three words).** Long labels widen the gap between ranks and push everything apart. Explanations belong in a `tooltip` or the node's Markdown.
16. **Use dashes for meaning, not decoration.** Use one dashed style for one meaning, such as "async" or "planned", and define it once as a class.
17. **Leave replies out.** Draw the request (`user -> api`); the reply is implied. A separate `api -> user` creates a cycle, and the engine has to route it back across the whole diagram. `user <-> api` avoids the cycle on TALA and ELK, but in the URL shortener dagre drew its arrowhead in empty space next to Visitor, and a plain `->` fixed it. If the order of messages matters, use a sequence diagram.

### Labels and icons (lines through labels)

18. **Draw pictures as `shape: image` at 128x128, with no box around them.** A picture is the node; do not wrap it in an ordinary shape with `icon:`. A fixed 128x128 lines the pictures up into an even grid and gives them room to read at the zoom a whole diagram is viewed at:

    ```d2
    classes: {
      service: {
        shape: image
        width: 128
        height: 128
      }
    }
    cf: "CloudFront\ncache redirects" {class: service; icon: https://icons.terrastruct.com/...}
    ```

    Known cost: the caption of an image sits outside the image's box, so the engine does not reserve room for it. TALA and dagre can route lines through captions; ELK leaves room but can end an edge at the bottom of a caption. Keep captions short (two lines of a few words) and prefer ELK when lines cross them. Results on the URL shortener (captions were measured at 64x64; boxed icons are listed for comparison only):

    | Source | TALA | ELK | dagre |
    | --- | --- | --- | --- |
    | `shape: image`, caption below (the demo) | Lines cross captions | Captions clear; some edges end at the caption | Lines cross captions |
    | `shape: image` plus `label.near: outside-bottom-center` | Lines cross captions; captions overlap | Captions clear; some edges end at the caption | Captions clear; some edges leave from beside the caption |
    | Ordinary shape, only `icon.near: top-center` | Clean | Label drawn over the icon | Label drawn over the icon |
    | Ordinary shape, invisible box (`fill`/`stroke: transparent`) | Captions clear; arrows stop short of the icon | Label drawn over the icon | Label drawn over the icon |
    | **Ordinary shape, `icon.near: top-center` and `label.near: bottom-center`** | **Clean** | **Clean** | **Clean** |

    In D2 v0.9 no engine both ends lines at a bare picture and keeps them off its caption: an edge ends at the node's box, and the box of an image is the picture alone.
19. **Do not shrink labelled shapes with `width`/`height`.** A fixed size smaller than the label pushes the label outside the shape. (Pictures are the exception: rule 18.)
20. **Fix the title's position with `near: top-center`.** Without `near`, the title is just another node and lands wherever the layout puts it.
21. **Do not add icons as decorative nodes, and do not put icons on containers.** An icon on its own (a language logo, a mascot) is a node that the engine has to place and route around. ELK and dagre draw a container's icon outside its top-left corner, where lines cross it (the TS and Go icons in the ecosystem demo). Put the icon on the shape it describes, or leave it out.

### Style

22. **Define styles once with `classes`, and apply them with `class:`.** Use globs (`*.style...`, `**.style...`) for whole-board defaults. Inline `style.` repeated on every edge (35 times in lion_reader) is hard to keep consistent and hard to change.
23. **Use `vars.d2-legend` for a legend**, not a container of example boxes. A hand-built legend is laid out like any other shape and ends up wherever the engine puts it.
24. **Prefer a theme (`theme-id`, `dark-theme-id`) to hand-picked fills.** Themes switch cleanly between light and dark. Hard-coded hex fills do not change for dark mode.
25. **Use colour for categories only, and keep to about five.** If colour means "subsystem", every subsystem gets one colour from one class. Do not change colours inside a subsystem.
26. **Write `tooltip` and `link` for the web.** In d2web they are interactive. In PNG and PDF exports they become a numbered appendix (ross, lion). For a static export, drop them or put the text in labels.

### Features to avoid

- `top`/`left`, `near` to another object, and `width`/`height` on containers: they do not compile on every engine (rules 9 and 11).
- `direction` on a container: only TALA honours it (rule 8).
- A box around a picture (an ordinary shape with `icon:`): draw the picture itself as `shape: image` (rule 18).
- `style.3d`, `multiple`, `shadow`, `double-border` used everywhere: noise without meaning. Use them only where they mean something, such as `multiple` for "several replicas".
- Deeply nested containers used only to group things visually: a `class` with a shared fill, or a separate board, does the job without the extra routing.
- Hand-numbered steps (`"1. Server mutation"`) to show order: use `steps` or a sequence diagram.

## Checklist before committing a diagram

- Fewer than about 30 shapes on this board? If not, split it into layers.
- At most two levels of nesting?
- Do edges connect at the level of this board, with no leaf-to-leaf edges across containers?
- Is `direction` set at the root only? Are there no `top`/`left`, no `near` to an object, and no `width`/`height` on containers?
- Are pictures `shape: image` at 128x128, with no box around them and short captions? Is the title fixed with `near`?
- Are styles in `classes`, the legend in `vars.d2-legend`, and edge labels three words or fewer?
- Does it compile and render without crossed labels on TALA, ELK and dagre?

## How the rules were checked

All on D2 v0.9.0 with `d2 --layout=<engine>`, on 2 November 2026:

- **Compile errors on all three engines** with small test files: `near` to an object, `top`/`left` and container `width`/`height` fail as quoted in rules 9 and 11. A container `direction` compiles everywhere, but ELK and dagre ignore it. `vars.d2-legend`, a title with `near: top-center`, and a 12-node overview compile on all three.
- **Icon placements** (rule 18): every row of the table was rendered on all three engines from the URL shortener demo, with the replies merged as in rule 17.
- **Overview versus one big board** (rules 1–4): replacing the 150 tpmjs shapes with a 12-node overview gives a clean TALA layout in 110 ms; the full board takes seconds on TALA and is unreadable on TALA and ELK. The overview compiles on all three engines; only the TALA render was inspected.
- **The two demos** were rewritten to these rules and rendered on all three engines (the rewrites are not yet on the demo page). TALA and ELK are clean. On dagre, one edge still runs across another node's box (`user -> edge.cf` across WAF), which comes from how dagre routes edges across containers.
- On dagre, in the URL shortener, `user <-> edge.cf` drew its arrowhead in empty space next to Visitor; `user -> edge.cf` did not. Small cases with `<->`, a person shape and an edge into a container child do not reproduce it, so rule 17 is based on this one diagram.
- **A small two-container diagram** (diners and restaurants): with edges entering from above, ELK ran them through the "Restaurants" title. Removing the duplicate container-level edge (rule 13) and setting `direction: right` (rule 8) gave clean layouts on ELK and dagre. On TALA, two edges into the same node shared their last segment.
- Rules 5–7, 10, 14–16 and 22–26 come from the renders and the D2 source, without a before-and-after test.
