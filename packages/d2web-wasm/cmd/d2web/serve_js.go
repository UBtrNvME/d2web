//go:build js && wasm

package main

import (
	"context"
	"syscall/js"

	"d2web.local/wasm/compile"
)

// Exposes globalThis.d2webReady (the ready message) and d2webCompile(requestJSON) -> Promise<string JSON>. Work runs in a goroutine
// because a js.FuncOf callback pauses the event loop; requests still run one at a time on the single wasm thread.
func init() {
	serve = func() {
		js.Global().Set("d2webReady", string(compile.Ready()))
		js.Global().Set("d2webCompile", js.FuncOf(func(this js.Value, args []js.Value) any {
			request := args[0].String()
			var executor js.Func
			executor = js.FuncOf(func(this js.Value, p []js.Value) any {
				resolve := p[0]
				go func() {
					resolve.Invoke(string(compile.Handle(context.Background(), []byte(request))))
					executor.Release()
				}()
				return nil
			})
			return js.Global().Get("Promise").New(executor)
		}))
		// d2webSetFonts(names: string[], buffers: Uint8Array[]) -> "" or an error message (spec 0007); bytes are copied, not base64-encoded.
		js.Global().Set("d2webSetFonts", js.FuncOf(func(this js.Value, args []js.Value) any {
			names, buffers := args[0], args[1]
			list := make([]compile.FontInput, names.Length())
			for i := range list {
				buffer := buffers.Index(i)
				data := make([]byte, buffer.Get("length").Int())
				js.CopyBytesToGo(data, buffer)
				list[i] = compile.FontInput{Name: names.Index(i).String(), Data: data}
			}
			if err := compile.SetFonts(list); err != nil {
				return err.Error()
			}
			return ""
		}))
		select {}
	}
}
