// Command d2web is the worker's Go entry. Without arguments beyond a request it runs once (native and Node/WASM tests); the js/wasm
// build adds --serve, which keeps one instance alive behind globalThis.d2webCompile (serve_js.go).
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"d2web.local/wasm/compile"
)

// serve is set by serve_js.go on js/wasm.
var serve func()

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--serve" && serve != nil {
		serve()
	}
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "expected one compile request as JSON")
		os.Exit(1)
	}
	var peek struct {
		Type string `json:"type"`
	}
	if json.Unmarshal([]byte(os.Args[1]), &peek) == nil && peek.Type == "preflight" {
		os.Stdout.Write(compile.Preflight([]byte(os.Args[1])))
		return
	}
	os.Stdout.Write(compile.Handle(context.Background(), []byte(os.Args[1])))
}
