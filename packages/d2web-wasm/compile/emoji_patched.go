//go:build d2webpatched

package compile

import "github.com/d2lang/d2/d2renderers/d2fonts"

// Needs docs/upstream/d2fonts-wasm-supply-bundled-emoji.patch; mise run build adds the d2webpatched tag when it is applied.
func supplyEmoji(data []byte) error {
	return d2fonts.SetBundledNotoColorEmoji(data)
}
