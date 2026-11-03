// Package keywords describes the D2 keywords an element can carry and the values each takes (spec 0017 §3.2).
// Names and enums come from D2's own tables; number ranges and booleans are validated only in code
// (d2graph), so they are written here and probed against D2 by keywords_test.go.
package keywords

import (
	"sort"

	"github.com/d2lang/d2/d2ast"
	"github.com/d2lang/d2/d2target"
)

type Domain struct {
	Kind   string   `json:"kind"` // enum | number | boolean | color | text
	Values []string `json:"values,omitempty"`
	Min    *float64 `json:"min,omitempty"`
	Max    *float64 `json:"max,omitempty"`
}

type Keyword struct {
	Name      string `json:"name"`
	Style     bool   `json:"style"`               // written as style.<name>
	Validated bool   `json:"validated,omitempty"` // D2 rejects a value outside the domain
	Domain    Domain `json:"domain"`
}

type Result struct {
	D2         string    `json:"d2"`
	Shapes     []string  `json:"shapes"`
	Arrowheads []string  `json:"arrowheads"`
	Keywords   []Keyword `json:"keywords"`
}

func f(v float64) *float64 { return &v }

func num(min, max *float64) Domain { return Domain{Kind: "number", Min: min, Max: max} }

var (
	boolean = Domain{Kind: "boolean"}
	color   = Domain{Kind: "color"}
	text    = Domain{Kind: "text"}
)

func enum(v []string) Domain { return Domain{Kind: "enum", Values: v} }

func Table() Result {
	arrowheads := make([]string, 0, len(d2target.Arrowheads))
	for a := range d2target.Arrowheads {
		arrowheads = append(arrowheads, a)
	}
	sort.Strings(arrowheads)
	count := num(f(1), nil)
	k := []Keyword{
		{Name: "label", Domain: text},
		{Name: "shape", Validated: true, Domain: enum(d2target.Shapes)},
		{Name: "icon", Domain: text},
		{Name: "constraint", Domain: text},
		{Name: "tooltip", Domain: text},
		{Name: "link", Domain: text},
		{Name: "near", Domain: enum(d2ast.NearConstantsArray)},
		{Name: "width", Domain: num(f(0), nil)},
		{Name: "height", Domain: num(f(0), nil)},
		{Name: "direction", Validated: true, Domain: enum([]string{"up", "down", "right", "left"})},
		{Name: "top", Domain: num(f(0), nil)},
		{Name: "left", Domain: num(f(0), nil)},
		{Name: "grid-rows", Domain: count},
		{Name: "grid-columns", Domain: count},
		{Name: "grid-gap", Domain: num(f(0), nil)},
		{Name: "vertical-gap", Domain: num(f(0), nil)},
		{Name: "horizontal-gap", Domain: num(f(0), nil)},
		{Name: "class", Domain: text},
		{Name: "vars", Domain: text},
		{Name: "opacity", Style: true, Domain: num(f(0), f(1))},
		{Name: "stroke", Style: true, Domain: color},
		{Name: "fill", Style: true, Domain: color},
		{Name: "fill-pattern", Style: true, Validated: true, Domain: enum(d2ast.FillPatterns)},
		{Name: "stroke-width", Style: true, Domain: num(f(0), f(15))},
		{Name: "stroke-dash", Style: true, Domain: num(f(0), f(10))},
		{Name: "border-radius", Style: true, Domain: num(f(0), nil)},
		{Name: "font", Style: true, Domain: text},
		{Name: "font-size", Style: true, Domain: num(f(8), f(100))},
		{Name: "font-color", Style: true, Domain: color},
		{Name: "bold", Style: true, Domain: boolean},
		{Name: "italic", Style: true, Domain: boolean},
		{Name: "underline", Style: true, Domain: boolean},
		{Name: "text-transform", Style: true, Validated: true, Domain: enum(d2ast.TextTransforms)},
		{Name: "shadow", Style: true, Domain: boolean},
		{Name: "multiple", Style: true, Domain: boolean},
		{Name: "double-border", Style: true, Domain: boolean},
		{Name: "3d", Style: true, Domain: boolean},
		{Name: "animated", Style: true, Domain: boolean},
		{Name: "filled", Style: true, Domain: boolean},
	}
	sort.Slice(k, func(i, j int) bool { return k[i].Name < k[j].Name })
	return Result{D2: "v0.9.0", Shapes: d2target.Shapes, Arrowheads: arrowheads, Keywords: k}
}
