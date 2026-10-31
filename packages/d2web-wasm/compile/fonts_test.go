package compile

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/d2lang/d2/d2renderers/d2fonts"
)

// Spec 0007: consumer fonts reach the scene as per-glyph assets, and uncovered characters are reported.
func request(source string) []byte {
	raw, _ := json.Marshal(map[string]any{
		"v": 1, "type": "compile", "id": 1, "revision": 1, "files": map[string]string{"main.d2": source}, "entry": "main.d2", "layout": "dagre",
		"render":  map[string]any{"themeId": 0, "sketch": false, "pad": 0, "scale": 1, "center": false},
		"budgets": map[string]any{"maxNodes": 100000, "maxPathCommands": 1000000, "sketch": map[string]int{"maxOperationSets": 100000, "maxOperations": 1000000, "maxPathCommands": 1000000}, "links": map[string]int{"maxRegions": 1000, "maxStringBytes": 100000}, "svgImport": map[string]int{}},
		"boards":  []string{""},
	})
	return raw
}

func compileText(t *testing.T, source string) map[string]any {
	t.Helper()
	var res map[string]any
	if err := json.Unmarshal(Handle(context.Background(), request(source)), &res); err != nil {
		t.Fatal(err)
	}
	if res["error"] != nil {
		t.Fatalf("compile error: %v", res["error"])
	}
	return res
}

func TestConsumerFontCoversArabicAndMissingGlyphIsReported(t *testing.T) {
	data, err := os.ReadFile("../tests/fixtures/fonts/Amiri-Regular.ttf")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = SetFonts(nil) })

	// Without a listed font nothing is resolved and nothing is reported.
	res := compileText(t, "a: عربي\nb: あ\n")
	if fonts, _ := res["fonts"].(map[string]any); len(fonts) != 1 {
		t.Fatalf("expected only the primary font without consumer fonts, got %d", len(fonts))
	}
	if len(res["diagnostics"].([]any)) != 0 {
		t.Fatalf("no diagnostics expected without consumer fonts: %v", res["diagnostics"])
	}

	if err := SetFonts([]FontInput{{Name: "Amiri", Data: data}}); err != nil {
		t.Fatal(err)
	}
	res = compileText(t, "a: عربي\nb: あ\n")
	if fonts, _ := res["fonts"].(map[string]any); len(fonts) < 2 {
		t.Fatalf("the listed font should arrive in result.fonts, got %d fonts", len(fonts))
	}
	var warnings []string
	for _, d := range res["diagnostics"].([]any) {
		m := d.(map[string]any)
		if m["severity"] == "warning" {
			warnings = append(warnings, m["message"].(string))
		}
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], "b: no listed font covers U+3042") {
		t.Fatalf("expected one missing-glyph warning for b (U+3042), got %v", warnings)
	}
}

func TestSetFontsRejectsBrokenFiles(t *testing.T) {
	t.Cleanup(func() { _ = SetFonts(nil) })
	if err := SetFonts([]FontInput{{Name: "bad", Data: []byte("not a font")}}); err == nil {
		t.Fatal("a non-font file must be refused")
	}
	if err := SetFonts([]FontInput{{Name: "", Data: []byte{1}}}); err == nil {
		t.Fatal("a nameless font must be refused")
	}
}

// Spec 0007: the resolver prefers the covering face closest to the requested weight and slant; order only breaks ties.
func TestResolverPrefersTheRequestedWeightAndSlant(t *testing.T) {
	dir := func(module string) string {
		out, err := exec.Command("go", "list", "-m", "-f", "{{.Dir}}", module).Output()
		if err != nil {
			t.Skipf("module %s is not in the module cache: %v", module, err)
		}
		return strings.TrimSpace(string(out))
	}
	read := func(path string) []byte {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Skipf("fixture font missing: %v", err)
		}
		return data
	}
	regular := read(dir("github.com/go-text/typesetting") + "/font/testdata/Roboto-Regular.ttf")
	boldItalic := read(dir("github.com/go-text/typesetting-utils") + "/opentype/common/Go-Mono-Bold-Italic.ttf")
	t.Cleanup(func() { _ = SetFonts(nil) })

	pick := func(order []FontInput, request d2fonts.FallbackRequest) string {
		if err := SetFonts(order); err != nil {
			t.Fatal(err)
		}
		resolver := &consumerResolver{missing: map[rune]struct{}{}}
		out, err := resolver.ResolveFallbacks(context.Background(), request)
		if err != nil || len(out) != 1 {
			t.Fatalf("expected one face, got %d (%v)", len(out), err)
		}
		return out[0].Name
	}
	ab := []FontInput{{Name: "regular", Data: regular}, {Name: "bold-italic", Data: boldItalic}}
	ba := []FontInput{ab[1], ab[0]}
	for _, order := range [][]FontInput{ab, ba} {
		if got := pick(order, d2fonts.FallbackRequest{Runes: []rune{'a'}, Style: "bold italic", Weight: 700}); got != "bold-italic" {
			t.Errorf("bold italic request got %s", got)
		}
		if got := pick(order, d2fonts.FallbackRequest{Runes: []rune{'a'}, Style: "regular", Weight: 400}); got != "regular" {
			t.Errorf("regular request got %s", got)
		}
		if got := pick(order, d2fonts.FallbackRequest{Runes: []rune{'a'}, Style: "bold"}); got == "" {
			t.Errorf("a style word alone must still resolve")
		}
	}
	// A weight the listed faces cannot match still resolves to the only covering face.
	if got := pick([]FontInput{{Name: "bold-italic", Data: boldItalic}}, d2fonts.FallbackRequest{Runes: []rune{'a'}, Weight: 300}); got != "bold-italic" {
		t.Errorf("the only covering face must be used, got %s", got)
	}
}
