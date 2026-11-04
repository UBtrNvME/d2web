---
title: "Connection label cut-outs use image masks, because Safari ignores masks pointing at inline SVG"
author: Aitemir
date: 2026-11-04
standing: true
id: l-5a69c89a
scope: repo
status: active
src: init-review
---

## Watch out
- Safari does not resolve a mask URL reference to an inline SVG mask from an HTML element, so lines ran through connection labels.
- In the code: In the painter's HTML mode keep D2's label mask as a data-URI image with mask-image plus -webkit- properties. Do not revert to mask:url(#id). paint-mask.test.mjs guards it.

_From PR #3 here, Nov 2._
