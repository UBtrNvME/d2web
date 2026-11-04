---
title: "Images are fetched by the consumer, never by the offline worker"
author: Aitemir
date: 2026-11-04
standing: true
id: l-0de6b3f1
scope: repo
status: active
src: init-review
---

## Tried and ruled out
- Letting the worker fetch images would make arbitrary requests from untrusted D2 text, ignore the host's CORS, CSP and allowlist, and break the self-contained scene.
- In the code: Use the client `images` option: `bundle` (consumer resolver or map supplies bytes) or `link` (painter emits an img element). Unresolved images give a warning diagnostic and a placeholder, not a failed compile.

_From this repo's docs._
