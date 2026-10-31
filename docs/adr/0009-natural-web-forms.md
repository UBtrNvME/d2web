# 0009. D2 should be natural on the web, not look like native SVG

Status: accepted (user, 31 October 2026: stated the rule in chat, then "accept").

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
