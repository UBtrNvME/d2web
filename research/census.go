// Investigation probe: census of scene features per board for one corpus entry. Diagnostic, not a public schema.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image/color"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2layouts/d2talalayout"
	"github.com/d2lang/d2/d2lib"
	"github.com/d2lang/d2/d2renderers/d2scene"
	"github.com/d2lang/d2/d2renderers/d2scenebuild"
	"github.com/d2lang/d2/d2renderers/d2svg"
	"github.com/d2lang/d2/d2renderers/d2svgimport"
	"github.com/d2lang/d2/d2target"
	"github.com/d2lang/d2/lib/imageasset"
	"github.com/d2lang/d2/lib/log"
	"github.com/d2lang/d2/lib/textmeasure"
)

type board struct {
	Path       string         `json:"path"`
	Error      string         `json:"error,omitempty"`
	Nodes      int            `json:"nodes,omitempty"`
	Primitives map[string]int `json:"primitives,omitempty"`
	Paints     map[string]int `json:"paints,omitempty"`
	Filters    map[string]int `json:"filters,omitempty"`
	Features   map[string]int `json:"features,omitempty"`
	Assets     map[string]int `json:"assets,omitempty"`
	Links      int            `json:"links,omitempty"`
}

type result struct {
	Error  string  `json:"error,omitempty"`
	Boards []board `json:"boards"`
	// Export holds the root board's text runs, font files and native SVG for browser repainting (only with a fonts directory).
	Export *export `json:"export,omitempty"`
}

type export struct {
	ViewBox d2scene.Box       `json:"viewBox"`
	Runs    []exportRun       `json:"runs"`
	Fonts   map[string]string `json:"fonts"`
	SVG     string            `json:"svg"`
	// Scene is the whole document with every struct tagged by type name ("$"); a diagnostic dump, not a bridge schema.
	Scene any `json:"scene"`
}

type exportRun struct {
	ID      string  `json:"id"`
	Text    string  `json:"text"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Size    float64 `json:"size"`
	Asset   string  `json:"asset"`
	Fill    string  `json:"fill"`
	Scaled  bool    `json:"scaled"`
	Anchor  int     `json:"anchor"`
	Advance float64 `json:"advance"`
}

func main() {
	if len(os.Args) < 3 || len(os.Args) > 4 {
		fmt.Fprintln(os.Stderr, "expected workspace directory, entry and optional fonts directory")
		os.Exit(1)
	}
	fonts := ""
	if len(os.Args) == 4 {
		fonts = os.Args[3]
	}
	json.NewEncoder(os.Stdout).Encode(run(os.Args[1], os.Args[2], fonts))
}

func run(dir, entry, fontsDir string) (r result) {
	r.Boards = []board{}
	source, err := os.ReadFile(filepath.Join(dir, entry))
	if err != nil {
		r.Error = err.Error()
		return
	}
	ctx, cancel := context.WithTimeout(log.WithDefault(context.Background()), 90*time.Second)
	defer cancel()
	ruler, err := textmeasure.NewRuler()
	if err != nil {
		r.Error = err.Error()
		return
	}
	layout, pad, scale, theme := "tala", int64(0), 1.0, int64(0)
	opts := &d2svg.RenderOpts{Pad: &pad, Scale: &scale, ThemeID: &theme}
	target, _, err := d2lib.Compile(ctx, string(source), &d2lib.CompileOptions{
		InputPath: entry, FS: os.DirFS(dir), Ruler: ruler, Layout: &layout,
		LayoutResolver: func(string) (d2graph.LayoutGraph, error) {
			return func(ctx context.Context, g *d2graph.Graph) error {
				return d2talalayout.Layout(ctx, g, &d2talalayout.Options{Seeds: []int64{1}, MaxConcurrency: 1})
			}, nil
		},
		RouterResolver: func(string) (d2graph.RouteEdges, error) { return d2talalayout.RouteEdges, nil },
	}, opts)
	if err != nil {
		r.Error = "compile: " + err.Error()
		return
	}
	build := d2scenebuild.Options{
		Pad: opts.Pad, Scale: opts.Scale, Center: opts.Center, ThemeID: opts.ThemeID, ThemeOverrides: opts.ThemeOverrides, Sketch: opts.Sketch != nil && *opts.Sketch, SketchBudget: d2scenebuild.SketchBudget{MaxOperationSets: 100000, MaxOperations: 1000000, MaxPathCommands: 1000000}, MaxNodes: 100000, MaxPathCommands: 1000000,
		LinkBudget: d2scenebuild.LinkBudget{MaxRegions: 10000, MaxStringBytes: 1000000},
		// Same research limits as the rich probe; not recommendations.
		Assets: &d2scenebuild.AssetOptions{
			SVGImportLimits: d2svgimport.Limits{MaxBytes: 1 << 20, MaxDepth: 64, MaxElements: 10000, MaxAttributes: 50000, MaxAttributeBytes: 1 << 20, MaxPathCommands: 100000, MaxTransformFunctions: 10000, MaxUseDepth: 8, MaxResources: 1000},
			SVGImportBudget: d2scenebuild.SVGImportBudget{MaxSourceBytes: 1 << 22, MaxElements: 100000, MaxAttributes: 500000, MaxAttributeBytes: 1 << 22, MaxPathCommands: 1000000, MaxTransformFunctions: 100000, MaxDeclaredResources: 10000, MaxExpandedUseInstances: 10000},
		},
	}
	var walk func(string, *d2target.Diagram)
	walk = func(path string, d *d2target.Diagram) {
		// Build refuses nested boards, so each board is built on its own.
		leaf := *d
		leaf.Layers, leaf.Scenarios, leaf.Steps = nil, nil, nil
		// Local files resolve from the workspace; the network is always unavailable, so remote images become placeholders.
		resolver, err := imageasset.New(imageasset.Options{BaseDir: dir, HTTPClient: &http.Client{Transport: offline{}}, Limits: imageasset.Limits{
			MaxFetchedBytes: 1 << 22, MaxEncodedBytes: 1 << 22, MaxDecompressedBytes: 1 << 22, MaxSVGBytes: 1 << 20,
			MaxDecodedWidth: 4096, MaxDecodedHeight: 4096, MaxDecodedPixels: 1 << 24,
			MaxAssets: 256, MaxCumulativeEncodedBytes: 32 << 20, MaxCumulativeDecodedBytes: 128 << 20,
		}})
		options := build
		assets := *build.Assets
		assets.Resolver = resolver
		options.Assets = &assets
		if err != nil {
			r.Boards = append(r.Boards, board{Path: path, Error: err.Error()})
		} else {
			var exp *export
			if path == "" && fontsDir != "" {
				exp = &export{Fonts: map[string]string{}}
				r.Export = exp
			}
			b := census(ctx, path, &leaf, options, exp, fontsDir)
			if exp != nil && b.Error == "" {
				if svg, err := d2svg.Render(&leaf, opts); err != nil {
					r.Error = "native svg: " + err.Error()
				} else {
					exp.SVG = string(svg)
				}
			}
			r.Boards = append(r.Boards, b)
		}
		for _, group := range []struct {
			name   string
			boards []*d2target.Diagram
		}{{"layers", d.Layers}, {"scenarios", d.Scenarios}, {"steps", d.Steps}} {
			for _, child := range group.boards {
				walk(fmt.Sprintf("%s/%s/%s", path, group.name, child.Name), child)
			}
		}
	}
	walk("", target)
	return
}

func census(ctx context.Context, path string, d *d2target.Diagram, build d2scenebuild.Options, exp *export, fontsDir string) board {
	b := board{Path: path, Primitives: map[string]int{}, Paints: map[string]int{}, Filters: map[string]int{}, Features: map[string]int{}, Assets: map[string]int{}}
	doc, err := d2scenebuild.Build(ctx, d, build)
	if err != nil {
		b.Error = err.Error()
		return b
	}
	b.Links = len(doc.Links)
	for id, asset := range doc.Assets {
		b.Assets[fmt.Sprintf("%T", asset)]++
		if fa, ok := asset.(d2scene.FontAsset); ok && exp != nil {
			name := strings.ReplaceAll(string(id), ":", "_") + ".font"
			if err := os.WriteFile(filepath.Join(fontsDir, name), fa.Data, 0o644); err != nil {
				b.Error = err.Error()
				return b
			}
			exp.Fonts[string(id)] = name
		}
	}
	if exp != nil {
		exp.ViewBox = doc.ViewBox
		exp.Scene = tagged(reflect.ValueOf(doc))
	}
	var visit func(*d2scene.Node, d2scene.Matrix)
	visit = func(n *d2scene.Node, parent d2scene.Matrix) {
		acc := parent.Mul(n.Transform)
		if p, ok := n.Primitive.(d2scene.TextRun); ok && exp != nil {
			at := acc.Point(p.Origin)
			fill := ""
			if sp, ok := p.Fill.(d2scene.SolidPaint); ok {
				fill = fmt.Sprintf("rgba(%d,%d,%d,%.3f)", sp.Color.R, sp.Color.G, sp.Color.B, float64(sp.Color.A)/255)
			}
			var advance float64
			for _, g := range p.Glyphs {
				advance += g.Advance
			}
			exp.Runs = append(exp.Runs, exportRun{n.ID, p.Text, at.X, at.Y, p.Font.Size, string(p.Font.Asset), fill, acc.A != 1 || acc.D != 1 || acc.B != 0 || acc.C != 0, int(p.Anchor), advance})
		}
		b.Nodes++
		if n.Primitive != nil {
			b.Primitives[fmt.Sprintf("%T", n.Primitive)]++
			v := reflect.ValueOf(n.Primitive)
			for _, field := range []string{"Fill", "Stroke"} {
				f := v.FieldByName(field)
				if f.IsValid() && !f.IsNil() {
					b.Paints[field+":"+fmt.Sprintf("%T", f.Interface())]++
				}
			}
		}
		for _, f := range n.Filters {
			b.Filters[fmt.Sprintf("%T", f)]++
		}
		for name, on := range map[string]bool{"clip": n.Clip != nil, "mask": n.Mask != nil, "blend": n.Blend != d2scene.BlendNormal, "animation": len(n.Animations) > 0, "transform": n.Transform != d2scene.Identity(), "opacity": n.Opacity != 1} {
			if on {
				b.Features[name]++
			}
		}
		if n.Mask != nil && n.Mask.Root != nil {
			visit(n.Mask.Root, acc)
		}
		for _, c := range n.Children {
			visit(c, acc)
		}
	}
	visit(doc.Root, d2scene.Matrix{A: 1, D: 1})
	return b
}

type offline struct{}

func (offline) RoundTrip(*http.Request) (*http.Response, error) { return nil, errors.New("offline") }

// tagged converts any scene value to JSON-friendly data, naming each struct's type so closed interfaces survive.
func tagged(v reflect.Value) any {
	switch v.Kind() {
	case reflect.Invalid:
		return nil
	case reflect.Interface, reflect.Ptr:
		if v.IsNil() {
			return nil
		}
		return tagged(v.Elem())
	case reflect.Struct:
		if c, ok := v.Interface().(color.NRGBA); ok {
			return fmt.Sprintf("rgba(%d,%d,%d,%.4f)", c.R, c.G, c.B, float64(c.A)/255)
		}
		out := map[string]any{"$": v.Type().Name()}
		for i := 0; i < v.NumField(); i++ {
			if !v.Type().Field(i).IsExported() {
				continue
			}
			if _, font := v.Interface().(d2scene.FontAsset); font && v.Type().Field(i).Name == "Data" {
				continue
			}
			out[v.Type().Field(i).Name] = tagged(v.Field(i))
		}
		return out
	case reflect.Slice:
		if v.Type().Elem().Kind() == reflect.Uint8 {
			return v.Bytes()
		}
		out := make([]any, v.Len())
		for i := range out {
			out[i] = tagged(v.Index(i))
		}
		return out
	case reflect.Map:
		out := map[string]any{}
		for _, k := range v.MapKeys() {
			out[fmt.Sprint(k.Interface())] = tagged(v.MapIndex(k))
		}
		return out
	default:
		return v.Interface()
	}
}
