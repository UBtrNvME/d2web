package compile

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"testing"
)

// Spec 0010 test 6: the preflight lists the links, the compile serves supplied bytes by fragment-less URL, anything else is a placeholder
// plus a warning, and the worker accepts no more than its limits.

const goIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="#00ADD8"/></svg>`

func imageRequest(source string, files map[string]string, images map[string]ImageInput) []byte {
	if files == nil {
		files = map[string]string{"main.d2": source}
	}
	var m map[string]any
	_ = json.Unmarshal(request(source), &m)
	m["files"] = files
	m["budgets"].(map[string]any)["svgImport"] = map[string]int{"maxSourceBytes": 1 << 22, "maxElements": 100000, "maxAttributes": 500000, "maxAttributeBytes": 1 << 22, "maxPathCommands": 1000000,
		"maxTransformFunctions": 100000, "maxDeclaredResources": 10000, "maxExpandedUseInstances": 10000}
	m["boards"] = "all"
	if images != nil {
		m["images"] = images
	}
	raw, _ := json.Marshal(m)
	return raw
}

func compileImages(t *testing.T, source string, images map[string]ImageInput) map[string]any {
	t.Helper()
	var res map[string]any
	if err := json.Unmarshal(Handle(context.Background(), imageRequest(source, nil, images)), &res); err != nil {
		t.Fatal(err)
	}
	return res
}

// assetIDs lists the image assets of every board's scene; image:unavailable is D2's placeholder.
func assetIDs(t *testing.T, res map[string]any) []string {
	t.Helper()
	var ids []string
	for _, b := range res["boards"].([]any) {
		scene, _ := b.(map[string]any)["scene"].(map[string]any)
		for _, key := range []string{"Assets", "assets"} {
			if assets, ok := scene[key].(map[string]any); ok {
				for id := range assets {
					if strings.HasPrefix(id, "image:") {
						ids = append(ids, id)
					}
				}
			}
		}
	}
	sort.Strings(ids)
	return ids
}

func TestPreflightListsLinksOfEveryBoard(t *testing.T) {
	files := map[string]string{
		"main.d2": `
vars: { logo: https://i.test/logo.svg }
classes: { c: { icon: https://i.test/class.svg } }
a: { icon: ${logo} }
b.class: c
b -> a: { icon: https://i.test/edge.svg }
p: { shape: image; icon: "https://i.test/p.svg#frag" }
layers: { next: { x: { icon: https://i.test/layer.svg } } }
`,
	}
	raw, _ := json.Marshal(map[string]any{"v": 1, "type": "preflight", "id": 7, "files": files, "entry": "main.d2"})
	var res PreflightResult
	if err := json.Unmarshal(Preflight(raw), &res); err != nil {
		t.Fatal(err)
	}
	if res.Error != "" || res.ID != 7 || res.Type != "images" {
		t.Fatalf("unexpected result: %+v", res)
	}
	got := map[string]string{}
	for _, l := range res.Links {
		got[l.Board+"|"+l.ID+"|"+l.Kind] = l.Source
	}
	want := map[string]string{
		"|a|icon":                "https://i.test/logo.svg",
		"|b|icon":                "https://i.test/class.svg",
		"|(b -> a)[0]|edge-icon": "https://i.test/edge.svg",
		"|p|image":               "https://i.test/p.svg#frag",
		"/layers/next|x|icon":    "https://i.test/layer.svg",
	}
	if len(got) != len(want) {
		t.Fatalf("links = %v, want %v", got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %q, want %q (all: %v)", k, got[k], v, got)
		}
	}
}

func TestPreflightReportsAD2ErrorAndNoLinks(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{"v": 1, "type": "preflight", "id": 1, "files": map[string]string{"main.d2": "a: {"}, "entry": "main.d2"})
	var res PreflightResult
	_ = json.Unmarshal(Preflight(raw), &res)
	if res.Error == "" || len(res.Links) != 0 {
		t.Fatalf("expected an error and no links: %+v", res)
	}
}

func TestSuppliedImageBecomesAnAssetAndFragmentIsIgnored(t *testing.T) {
	source := "a: { icon: \"https://i.test/go.svg#frag\" }\nb: { icon: https://i.test/missing.svg }\n"
	res := compileImages(t, source, map[string]ImageInput{"https://i.test/go.svg#frag": {Type: "image/svg+xml", Data: []byte(goIcon)}})
	if res["error"] != nil {
		t.Fatalf("compile error: %v", res["error"])
	}
	echo := res["echo"].(map[string]any)
	if echo["images"] != "bundle" {
		t.Fatalf("echo.images = %v", echo["images"])
	}
	ids := assetIDs(t, res)
	hasReal, hasPlaceholder := false, false
	for _, id := range ids {
		if id == "image:unavailable" {
			hasPlaceholder = true
		} else {
			hasReal = true
		}
	}
	if !hasReal || !hasPlaceholder {
		t.Fatalf("expected a real asset for the supplied link and the placeholder for the missing one, got %v", ids)
	}
	diags := res["diagnostics"].([]any)
	if len(diags) != 1 {
		t.Fatalf("expected exactly one warning, got %v", diags)
	}
	d := diags[0].(map[string]any)
	if d["code"] != "image-unresolved" || d["severity"] != "warning" || !strings.Contains(d["message"].(string), "https://i.test/missing.svg") || !strings.Contains(d["message"].(string), "b") {
		t.Fatalf("unexpected diagnostic: %v", d)
	}
}

func TestWithoutImagesNothingIsReportedAndNothingResolves(t *testing.T) {
	res := compileImages(t, "a: { icon: https://i.test/go.svg }\n", nil)
	if res["error"] != nil || len(res["diagnostics"].([]any)) != 0 {
		t.Fatalf("default behaviour changed: %v", res)
	}
	if _, has := res["echo"].(map[string]any)["images"]; has {
		t.Fatal("echo.images must be absent without the images field")
	}
	for _, id := range assetIDs(t, res) {
		if id != "image:unavailable" {
			t.Fatalf("a real image asset appeared without supplied bytes: %s", id)
		}
	}
}

func TestStoreServesByFragmentlessURLAndRefusesTheRest(t *testing.T) {
	s := newImageStore(map[string]ImageInput{"https://I.test/a%20b.svg?x=1&y=2#frag": {Type: "image/svg+xml", Data: []byte("x")}})
	u, _ := url.Parse("https://I.test/a%20b.svg?x=1&y=2")
	resp, err := s.RoundTrip(&http.Request{URL: u})
	if err != nil || resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "image/svg+xml" {
		t.Fatalf("expected the supplied image: %v %v", resp, err)
	}
	other, _ := url.Parse("https://i.test/other.svg")
	if _, err := s.RoundTrip(&http.Request{URL: other}); err == nil {
		t.Fatal("an unsupplied URL must be an error")
	}
}

func TestStoreEnforcesTheLimitsAgain(t *testing.T) {
	big := make([]byte, maxImageBytes+1)
	in := map[string]ImageInput{"https://i.test/big.svg": {Data: big}, "https://i.test/empty.svg": {}}
	for i := 0; i < maxImageCount+1; i++ {
		in["https://i.test/n"+string(rune('a'+i%26))+strings.Repeat("x", i/26)+".svg"] = ImageInput{Data: []byte("x")}
	}
	s := newImageStore(in)
	if _, ok := s.byKey["https://i.test/big.svg"]; ok || s.rejected["https://i.test/big.svg"] == "" {
		t.Fatal("an oversized image must be rejected with a reason")
	}
	if _, ok := s.byKey["https://i.test/empty.svg"]; ok {
		t.Fatal("an empty image must be rejected")
	}
	if len(s.byKey) != maxImageCount {
		t.Fatalf("accepted %d images, want %d", len(s.byKey), maxImageCount)
	}
	// 32 MiB cumulative: nine 4 MiB images leave the ninth out.
	chunk := make([]byte, maxImageBytes)
	nine := map[string]ImageInput{}
	for i := 0; i < 9; i++ {
		nine["https://i.test/"+string(rune('a'+i))+".png"] = ImageInput{Data: chunk}
	}
	if got := len(newImageStore(nine).byKey); got != 8 {
		t.Fatalf("cumulative limit accepted %d images, want 8", got)
	}
}
