package compile

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
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
