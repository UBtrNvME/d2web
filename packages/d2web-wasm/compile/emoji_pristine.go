//go:build !d2webpatched

package compile

import "errors"

func supplyEmoji([]byte) error {
	return errors.New("colour emoji needs the patched D2 build (docs/upstream/d2fonts-wasm-supply-bundled-emoji.patch)")
}
