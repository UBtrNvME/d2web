# Web-native audit (1 November 2026)

What the shipping painter (`mount`, HTML-first with accessibility groups) emits today, per feature family, against the web form each family names in `tests/features/web-forms.mjs` (ADR 0009). Measured over the 279 catalog cases that need no consumer fonts, by mounting each in Chromium and counting elements in the shadow root. The throwaway script is not kept; rerun the idea with `[data-k=rect|ellipse|text|image]` (HTML), `svg[style*="overflow:visible"]` (SVG fallback), `a[data-k=link]` and `[role=group]`.

## Totals

- 1652 painted elements are real HTML (positioned `div` for rectangles and ellipses, `div` for text, `img` for raster images); 603 nested SVGs carry what HTML cannot draw. **73 % of painted elements are HTML.**
- 810 `role=group` objects with D2's names, descriptions and nesting; real `<a>` elements for every link.

## What stays SVG, and why that is the target form

Paths (connection lines, non-rectangular shape outlines, arrowheads), gradient and pattern fills, dashed or translucent strokes, filters, masks, clips and blends, and vector icons. The named web form for these families is SVG, so a high SVG share there is correct, not a gap (sketch 50 %, sequence 52 %, themes 59 % HTML because themes repaint every shape).

## Per family

| Family | Cases | HTML share | Verdict |
| --- | --- | --- | --- |
| containers, label positions, grid, size | 2 / 33 / 6 / 2 | 100 % | met: HTML boxes and text, groups, geometry from D2 |
| content | 20 | 96 % | partly met: links are `<a>`, raster icons are `img`; markdown, code and tables are positioned text boxes, not `p`/`pre`/`code`/`table` |
| board, language, tooltip | 5 / 8 / 8 | 83-89 % | met as designed; tooltips are `title`, no focus display |
| shapes, styles, arrowheads, connections, near, colour, effects, table | 25 / 30 / 18 / 10 / 9 / 10 / 9 / 6 | 67-81 % | met: SVG for outlines and lines, HTML for text and boxes |
| icon positions | 33 | 75 % | met: vector icons stay inline SVG (the named form allows it) |
| direction, layout engines, config, themes | 5 / 3 / 9 / 21 | 59-64 % | met: lower share only because more lines are drawn |
| sketch, sequence, animation, render | 2 / 2 / 2 / 1 | 50-71 % | met: D2's drawing is SVG by nature; animation is the Web Animations API on the painted element |
| unicode (10) | not measured | | checked against D2's advances instead |

## Gaps against the named forms

1. **Rich content is not semantic HTML.** Markdown, code blocks and SQL/class tables arrive from D2 as laid-out text runs and rectangles, so they are positioned text, with no `p`, `pre`, `code`, `table` or heading elements and no text reflow. Making them real elements means taking D2's markdown source (the association data carries it) and laying it out in HTML while keeping D2's box size. That conflicts with "faithful default" unless it is made an explicit, tested layout contract.
2. ~~Tooltips show through `title` only, not on keyboard focus~~ Fixed 2 November 2026 (spec 0009 stage C): focus shows a `role=tooltip` element.
3. **Text is one `div` per run**, not a paragraph per label, so selection across lines works but copy returns line fragments.
4. **Safari** and **Thai/Devanagari** shaping are unchecked.

Everything else in the named forms is met or is SVG by design.
