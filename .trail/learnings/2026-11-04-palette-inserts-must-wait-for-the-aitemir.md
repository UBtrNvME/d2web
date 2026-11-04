---
title: Palette inserts must wait for the current text to compile first
author: Aitemir
date: 2026-11-04
standing: true
id: l-815da52a
scope: repo
status: active
src: init-sessions
---

## Watch out
- Clicking Zone right after typing your own zone class used a stale class list. The editor then overwrote the user's styles with its default dash and transparent fill.
- In the code: Every palette button in d2editor waits until the canvas reflects the current text, and does nothing if the text doesn't compile. Don't read the class list or free keys from a stale result.

_From past Claude sessions here, Nov 3._
