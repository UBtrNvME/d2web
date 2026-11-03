# Spec 0006: accessible names, structure and descriptions

Status: **accepted with the recommended answers to questions 1-4** (user, 31 October 2026). Builds on [spec 0002](0002-mount-api.md) (`a11y` mount option, named focusable groups), [spec 0004](0004-association.md) (D2's own object data) and [ADR 0009](../adr/0009-natural-web-forms.md): D2 owns the semantics, d2web only expresses them with the web's accessibility attributes and adds no wording or behaviour of its own.
Delivered: partial: gaps in section 1 are only partly fixed (see notes there); screen-reader output never verified. A spec is a short-lived brief: it must end `delivered` (or be marked not delivered); an agent that finds it otherwise tells the user. (Audited 4 November 2026.)

## 1. Gaps found on a probe board (partly fixed since; see notes)

The mount makes every direct child of the scene root (except `root:*`) a `role="group" tabindex="0"` element named by its label text runs, or by its D2 ID when it has none (`paint.js`, `a11yAttrs`). A link anchor is named by its object's label (done, `links.spec.mjs`). Gaps:
- **Unlabeled connection**: no text run, so it is named `(a -> b)[0]`, an internal ID. *Partly fixed: `paint.js` adds `aria-description` for the `a -> b` spelling.*
- **Markdown label** (`m: |md **x** y |`): painted as a `markdown` subtree with no text runs, so the object is named by its ID `m`, not its text.
- **Nesting**: shapes inside a container are siblings of it in the scene (`c`, `c.d`, `c.e`); a screen reader cannot tell `c.d` is in `c`. *Partly fixed: `paint.js` adds `aria-owns`.*
- **Tooltips** (no link): the tooltip text is only the `title` of an unfocusable overlay, so keyboard and screen-reader users never get it.

## 2. What D2 already provides

The association payload (spec 0004) carries, per object: `id`, `kind` (shape or connection), `label` (D2's label text, markdown and code as written: `**x** y`, `fmt`), `content` (`markdown`, `code`), `parent` (container id), and for connections `src` and `dst`. Tooltips arrive on the scene's link regions. Everything below is a translation of those fields.

## 3. Proposal

| Gap | Web expression | Source of the words |
| --- | --- | --- |
| Unlabeled connection | `aria-label` = D2's own connection spelling, `a -> b` (the object ID without the `(…)[n]` wrapper), for `<->` and `--` as D2 spells them | D2 ID |
| Labeled connection | `aria-label` = the label (unchanged); `aria-description` = the same spelling, so endpoints are still announced | D2 label, D2 ID |
| Markdown or code label | `aria-label` = the label text exactly as D2 gives it | `association.label` |
| Container nesting | `aria-owns` on the container's group listing its children's element IDs; no DOM move, so geometry and paint order are unchanged | `association.parent` |
| Tooltip | `aria-description` = D2's tooltip text on the object's focusable group (the hover `title` stays) | scene link region |

Not changed: the group role (D2 does not say a shape is a button or a heading), tab order (paint order), the `a11y: false` opt-out, and no new visible UI (no focus popover).

## 4. Test plan (proposed)

1. Browser: `locator.ariaSnapshot()` and accessible-name assertions for each row of section 3, using the probe board and the catalog's tooltip, container and markdown cases.
2. Unlabeled `a -> b`, `a <-> b`, `a -- b` give three distinct, D2-spelled names.
3. `aria-owns` ids all resolve to elements in the same shadow root, and a board with a container and two nested layers keeps its pixels unchanged (feature-map comparison still passes).
4. Runs in Chromium and Firefox; WebKit with the wasm on the page thread.
5. Find-in-page (`window.find`) locates a label's text on a painted board; recorded as measured, not assumed.

## 5. Open questions for the user

1. **Markdown names.** Recommended: the label exactly as D2 gives it (`**x** y`), because stripping markup would be our own transformation. Alternative: strip markdown to plain text.
2. **Unlabeled connection names.** Recommended: D2's own spelling `a -> b`. Alternative: a spoken form ("a to b") which would add our wording and need localisation.
3. **Nesting.** Recommended: `aria-owns` with flat DOM. Alternative: nest the DOM, which would change the paint structure the geometry and masks rely on.
4. **Tooltips.** Recommended: description only, no visible focus popover (new UI behaviour of our own). Alternative: show the tooltip when its object has focus.

## 6. Verified, proposed, unknown

| Claim | State |
| --- | --- |
| The four gaps in section 1 | verified on a probe compile and `paint.js` |
| The fields in section 2 | verified in the association payload |
| `aria-owns` is announced the same way across Chromium, Firefox and Safari | unknown |
| Screen reader behaviour (VoiceOver, NVDA) | unknown; only the accessibility tree is tested |
| Find-in-page on painted text | unknown until the test runs |

## Inline-link naming follow-up (2 November 2026)

Recognized positioned and flowing markdown links use their rendered link text as the accessible name. Whole-object and unrecognized region overlays retain object-level names; unsafe URLs stay href-less. Object groups retain the complete D2 label. Animated fallback preserves the same named, focusable HTML object frame. `regressions.spec.mjs` covers two separately named links and animated content/events.
