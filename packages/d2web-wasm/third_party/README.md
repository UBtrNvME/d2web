# third_party

`goldmark/` is github.com/yuin/goldmark v1.8.5 (MIT, see its LICENSE) without tests and tooling, with one change: the two linkify regexps in `extension/linkify.go` compile on first use instead of at package init. Reason and test: docs/browser-support.md (WebKit worker start) and `tests/stack.test.mjs`. Remove the `replace` in `../go.mod` and this directory when goldmark makes those regexps lazy or D2 stops linking the extension package.
