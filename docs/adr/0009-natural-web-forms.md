# 0009. D2 should be natural on the web, not look like native SVG

Status: accepted (user, 31 October 2026: stated the rule in chat, then "accept"). Amended and accepted again 1 November 2026 (see Amendment).

Context: the feature map compares each painted case with native D2 pixel by pixel. That is a useful diagnostic for geometry and styling, but native D2 SVG is a static document. It paints link and tooltip corner badges, appendix footnotes and similar artefacts because an SVG file has no hover, focus or navigation. The web has natural elements and behaviour for these, and forcing the static look onto the web would work against it. The scene builder already leaves the badges out on purpose (`d2scenebuild` `Options.Appendix`).

Decision (the user's rule): d2web implements each D2 feature with the element or behaviour that is natural on the web. Nothing is required to look identical to native D2. Where the web's natural form differs from native, we do not bend the web toward native.
- D2 owns the semantics. d2web translates D2's own semantics and behaviour (what a link, tooltip, label, near, board or animation means in D2) to the web; it does not add side effects or behaviour of its own on top (no invented interactions, defaults or policies). The web form is how D2's meaning is expressed, never a new meaning.
- Tooltips appear on hover and focus; they are not always-visible badges. Links are real anchors, keyboard reachable.
- Feature-map statuses gain **web-native**: native paints a static artefact where the web has its own behaviour; the difference is intended, not a gap, and is tested as behaviour (hover, click, focus, keyboard), not pixels.
- The pixel bar (ADR 0002/0007) stays for geometry and styling that has no other natural web form.
- Every feature family in `docs/feature-map.md` names its natural web form (`tests/features/web-forms.mjs`). New features are categorised that way from the start.
- We do not patch D2 or add painter code to reproduce native-only artefacts.

Alternatives: pixel parity with native as the goal (rejected by the user; produces static, inaccessible output); ignore native entirely (loses the geometry and styling safety net).

Consequences: some cases move from differs/size-mismatch to web-native; hover, click and focus tests for links and tooltips become required work; sketch shapes (native-style rough paths) stop being a parity gap but may still be judged on their own.

## Amendment (1 November 2026, user: "accept", after stating the direction)

Direction (the user's words, paraphrased): d2web is to become fully web native. For now we must be able to verify D2's behaviour and semantics and stay faithful to them, but everything is implemented so that each part can later be made fully web native.

- **Two layers, one rule.** Faithfulness is checked against D2's decisions (positions, sizes, text advances, names and associations, link targets, tooltips, animation timing), with native D2 as the reference. A more web-native painter must be able to pass the same checks. Pixel comparison stays a diagnostic and is not the contract; a web-native form that differs only in rasterisation is not a regression.
- **One boundary.** D2 (via the compile result: scene plus association data) decides; the painter turns that into DOM. Nothing beyond the painter may assume SVG-shaped output, so a feature family (text, shapes, links, containers, animation) can be replaced by a more native form on its own, without changing the compile side or its tests.
- **New work** names the natural web form of what it adds and the D2-level check that a native form would also pass (the existing `web-forms.mjs` rule, with the check named).
- **Patching D2** stays off by default. The line "we do not patch D2 ... to reproduce native-only artefacts" is unchanged. A patch is allowed only where D2 leaves a host without a public way to supply something D2 itself decides on (for example, the colour emoji font hook, `docs/upstream/d2fonts-wasm-supply-bundled-emoji.patch`), is carried in `docs/upstream`, needs `D2WEB_ALLOW_PATCHED=1`, and has a test that fails on pristine D2.
- **Link safety (added 1 November 2026, confirmed by the user the same day).** A D2 link is author text, and a `javascript:` link was found to become a live `href` that runs script in the host page. The painter now never writes `javascript:`, `vbscript:` or `data:` URLs into `href` (the anchor keeps its name and tooltip). This is the one place d2web declines to express a D2 value; it is a security boundary, not a new behaviour. Everything else (http, https, mailto, tel, relative) is passed through unchanged. Tests: `interaction.spec.mjs`.
