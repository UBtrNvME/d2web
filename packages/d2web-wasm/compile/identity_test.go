package compile

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

// The identity is Kroki's encoding: it must be URL-safe, and zlib-decode back to the exact source.
func decodeIdentity(t *testing.T, id string) string {
	t.Helper()
	raw, err := base64.URLEncoding.DecodeString(id)
	if err != nil {
		t.Fatal(err)
	}
	r, err := zlib.NewReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	out, _ := io.ReadAll(r)
	return string(out)
}

func TestIdentityRoundTripsAndIsURLSafe(t *testing.T) {
	for _, src := range []string{"a -> b", "x: Ünïcödé 日本語 ✓\ny -> x: ???>>>~~~\n", strings.Repeat("a -> b\n", 500)} {
		id := Identity(src)
		if strings.ContainsAny(id, "+/ ") {
			t.Fatalf("identity %q is not URL safe", id)
		}
		if got := decodeIdentity(t, id); got != src {
			t.Fatalf("round trip: %q != %q", got, src)
		}
		if Identity(src) != id {
			t.Fatal("identity is not deterministic")
		}
	}
}

func TestResultCarriesIdentityOfASingleFileOnly(t *testing.T) {
	res := compileText(t, "a -> b\n")
	if id, _ := res["identity"].(string); decodeIdentity(t, id) != "a -> b\n" {
		t.Fatalf("identity = %v", res["identity"])
	}
	var m map[string]any
	_ = json.Unmarshal(imageRequest("", map[string]string{"main.d2": "a", "other.d2": "b"}, nil), &m)
	raw, _ := json.Marshal(m)
	var two map[string]any
	_ = json.Unmarshal(Handle(context.Background(), raw), &two)
	if _, has := two["identity"]; has {
		t.Fatal("two files have no Kroki form, so no identity")
	}
}
