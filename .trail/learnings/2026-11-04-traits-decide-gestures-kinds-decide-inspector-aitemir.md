---
title: "Traits decide gestures; kinds decide inspector and conversion, and never duplicate traits"
author: Aitemir
date: 2026-11-04
standing: true
id: l-e160078d
scope: repo
status: active
src: init-sessions
---

## Decided
- The user worried that the new kinds model replaced the trait system. The two do different jobs and kinds must consume traits.
- In the code: Gesture behaviour (drop target, connect handles, movable) comes only from traits.ts and the press() arbiter. Conversion carry-over of children is answered by the `container` trait, not a list inside each kind. See spec 0018 §3.8.

_From past Claude sessions here, Nov 4._
