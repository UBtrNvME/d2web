//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
)

// Keeps one instance alive and exposes globalThis.d2compile(source) -> Promise<string JSON>. The work runs in a goroutine
// because a js.FuncOf callback pauses the event loop; requests still run one at a time on the single wasm thread.
func init() {
	serve = func() {
		js.Global().Set("d2compile", js.FuncOf(func(this js.Value, args []js.Value) any {
			source, engine := args[0].String(), ""
			if len(args) > 1 {
				engine = args[1].String()
			}
			var executor js.Func
			executor = js.FuncOf(func(this js.Value, p []js.Value) any {
				resolve := p[0]
				go func() {
					out, _ := json.Marshal(compileSource(source, engine))
					resolve.Invoke(string(out))
					executor.Release() // otherwise every request's source stays referenced by the callback registry
				}()
				return nil
			})
			return js.Global().Get("Promise").New(executor)
		}))
		select {}
	}
}
