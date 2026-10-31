package compile

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/d2lang/d2/d2renderers/d2fonts"
	"golang.org/x/image/font/sfnt"
)

// Spec 0007: fallback fonts are the consumer's. The page fetches them and hands the bytes over (SetFonts); this resolver offers them to D2's
// scene builder for code points the primary font lacks. Nothing is bundled and nothing is fetched here.

// FontInput is one consumer-listed font: Name is for diagnostics, Data the font file (a collection's faces are all offered).
type FontInput struct {
	Name string `json:"name"`
	Data []byte `json:"data"`
}

type fontFace struct {
	name  string
	data  []byte
	index uint16
	face  *sfnt.Font
}

var (
	fontsMu sync.Mutex
	faces   []fontFace
)

// SetFonts replaces the consumer's fallback list (in preference order). It parses every face, so a broken file fails here, not mid-compile.
func SetFonts(list []FontInput) error {
	next := make([]fontFace, 0, len(list))
	for _, in := range list {
		if in.Name == "" || len(in.Data) == 0 {
			return fmt.Errorf("font %q: name and data are required", in.Name)
		}
		collection, err := sfnt.ParseCollection(in.Data)
		if err != nil {
			return fmt.Errorf("font %q: %w", in.Name, err)
		}
		for i := 0; i < collection.NumFonts(); i++ {
			face, err := collection.Font(i)
			if err != nil {
				return fmt.Errorf("font %q face %d: %w", in.Name, i, err)
			}
			next = append(next, fontFace{name: in.Name, data: in.Data, index: uint16(i), face: face})
		}
	}
	fontsMu.Lock()
	faces = next
	fontsMu.Unlock()
	return nil
}

func (f fontFace) covers(r rune) bool {
	var buf sfnt.Buffer
	index, err := f.face.GlyphIndex(&buf, r)
	return err == nil && index != 0
}

// consumerResolver offers the consumer's faces, in their order, for the runes the primary font lacks; runes no face covers are remembered.
type consumerResolver struct {
	mu      sync.Mutex
	missing map[rune]struct{}
}

func (r *consumerResolver) ResolveFallbacks(_ context.Context, request d2fonts.FallbackRequest) ([]d2fonts.FallbackFont, error) {
	fontsMu.Lock()
	list := faces
	fontsMu.Unlock()
	remaining := map[rune]struct{}{}
	for _, c := range request.Runes {
		remaining[c] = struct{}{}
	}
	var out []d2fonts.FallbackFont
	for _, f := range list {
		used := false
		for c := range remaining {
			if f.covers(c) {
				delete(remaining, c)
				used = true
			}
		}
		if used {
			out = append(out, d2fonts.FallbackFont{Name: f.name, MIMEType: "font/ttf", Data: f.data, FaceIndex: f.index})
		}
	}
	if len(remaining) > 0 {
		r.mu.Lock()
		for c := range remaining {
			r.missing[c] = struct{}{}
		}
		r.mu.Unlock()
	}
	return out, nil
}

// uncovered returns the sorted runes some request could not place.
func (r *consumerResolver) uncovered() []rune {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]rune, 0, len(r.missing))
	for c := range r.missing {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// missingGlyphDiagnostics names every association object whose label holds a character no listed font covers (spec 0007 section 2.3).
func missingGlyphDiagnostics(board string, missing []rune, objects []AssocObject) []Diagnostic {
	var out []Diagnostic
	for _, o := range objects {
		var hit []string
		for _, c := range missing {
			if strings.ContainsRune(o.Label, c) {
				hit = append(hit, fmt.Sprintf("U+%04X", c))
			}
		}
		if len(hit) > 0 {
			out = append(out, Diagnostic{Severity: "warning", Board: board, Message: fmt.Sprintf("%s: no listed font covers %s; the browser paints its own fallback", o.ID, strings.Join(hit, " "))})
		}
	}
	return out
}
