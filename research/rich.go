// Investigation probe: dump what the native scene emits for rich content. Diagnostic, not a public schema.
package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2layouts/d2talalayout"
	"github.com/d2lang/d2/d2lib"
	"github.com/d2lang/d2/d2renderers/d2fonts"
	"github.com/d2lang/d2/d2renderers/d2scene"
	"github.com/d2lang/d2/d2renderers/d2scenebuild"
	"github.com/d2lang/d2/d2renderers/d2svg"
	"github.com/d2lang/d2/d2renderers/d2svgimport"
	"github.com/d2lang/d2/lib/log"
	"github.com/d2lang/d2/lib/textmeasure"
)

type node struct {
	ID          string         `json:"id"`
	Kind        string         `json:"kind"`
	Text        string         `json:"text,omitempty"`
	X           float64        `json:"x,omitempty"`
	Y           float64        `json:"y,omitempty"`
	Size        float64        `json:"size,omitempty"`
	Asset       string         `json:"asset,omitempty"`
	Glyph       int            `json:"glyphs,omitempty"`
	GlyphAssets map[string]int `json:"glyphAssets,omitempty"`
	Notdef      int            `json:"notdef,omitempty"`
}

// export carries what a browser needs to repaint text runs: absolute origins, fonts and the native SVG.
type export struct {
	ViewBox d2scene.Box       `json:"viewBox"`
	Runs    []exportRun       `json:"runs"`
	Fonts   map[string]string `json:"fonts"`
	SVG     string            `json:"svg"`
}

type exportRun struct {
	ID        string   `json:"id"`
	Text      string   `json:"text"`
	X         float64  `json:"x"`
	Y         float64  `json:"y"`
	Size      float64  `json:"size"`
	Weight    int      `json:"weight"`
	Style     string   `json:"style"`
	Asset     string   `json:"asset"`
	Fill      string   `json:"fill"`
	Scaled    bool     `json:"scaled"`
	Underline bool     `json:"underline"`
	Anchor    int      `json:"anchor"`
	Advance   float64  `json:"advance"`
	Fallbacks []string `json:"fallbacks,omitempty"`
}

type report struct {
	Error      string            `json:"error,omitempty"`
	Nodes      []node            `json:"nodes"`
	Assets     map[string]string `json:"assets"`
	Links      int               `json:"links"`
	TargetText map[string]string `json:"targetText"`
	SvgBytes   int               `json:"svgBytes"`
	SvgPaths   int               `json:"svgPaths"`
	Export     *export           `json:"export,omitempty"`
	SvgError   string            `json:"svgError,omitempty"`
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "expected D2 file")
		os.Exit(1)
	}
	source, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	flags := map[string]bool{}
	for _, a := range os.Args[2:] {
		flags[a] = true
	}
	fontsDir := ""
	for _, a := range os.Args[2:] {
		if strings.HasPrefix(a, "--fonts-dir=") {
			fontsDir = strings.TrimPrefix(a, "--fonts-dir=")
		}
	}
	out := run(string(source), flags["--assets"], flags["--export"], flags["--fallback"], fontsDir)
	json.NewEncoder(os.Stdout).Encode(out)
}

func run(source string, assets, exporting, fallback bool, fontsDir string) (r report) {
	r.Assets, r.TargetText = map[string]string{}, map[string]string{}
	ctx, cancel := context.WithTimeout(log.WithDefault(context.Background()), 60*time.Second)
	defer cancel()
	fail := func(err error) report { r.Error = err.Error(); return r }
	ruler, err := textmeasure.NewRuler()
	if err != nil {
		return fail(err)
	}
	layout, pad, scale, theme := "tala", int64(0), 1.0, int64(0)
	opts := &d2svg.RenderOpts{Pad: &pad, Scale: &scale, ThemeID: &theme}
	target, _, err := d2lib.Compile(ctx, source, &d2lib.CompileOptions{
		InputPath: "main.d2", Ruler: ruler, Layout: &layout, UTF16Pos: true,
		LayoutResolver: func(string) (d2graph.LayoutGraph, error) {
			return func(ctx context.Context, g *d2graph.Graph) error {
				return d2talalayout.Layout(ctx, g, &d2talalayout.Options{Seeds: []int64{1}, MaxConcurrency: 1})
			}, nil
		},
		RouterResolver: func(string) (d2graph.RouteEdges, error) { return d2talalayout.RouteEdges, nil },
	}, opts)
	if err != nil {
		return fail(err)
	}
	for _, s := range target.Shapes {
		r.TargetText[s.ID] = fmt.Sprintf("type=%s label=%q %dx%d", s.Type, s.Label, s.Text.LabelWidth, s.Text.LabelHeight)
	}
	build := d2scenebuild.Options{
		Pad: opts.Pad, Scale: opts.Scale, ThemeID: opts.ThemeID, MaxNodes: 10000, MaxPathCommands: 100000,
		LinkBudget: d2scenebuild.LinkBudget{MaxRegions: 1000, MaxStringBytes: 100000},
	}
	if assets {
		// Explicit, bounded SVG-import limits (research values, not recommendations).
		build.Assets = &d2scenebuild.AssetOptions{
			SVGImportLimits: d2svgimport.Limits{MaxBytes: 1 << 20, MaxDepth: 64, MaxElements: 10000, MaxAttributes: 50000, MaxAttributeBytes: 1 << 20, MaxPathCommands: 100000, MaxTransformFunctions: 10000, MaxUseDepth: 8, MaxResources: 1000},
			SVGImportBudget: d2scenebuild.SVGImportBudget{MaxSourceBytes: 1 << 22, MaxElements: 100000, MaxAttributes: 500000, MaxAttributeBytes: 1 << 22, MaxPathCommands: 1000000, MaxTransformFunctions: 100000, MaxDeclaredResources: 10000, MaxExpandedUseInstances: 10000},
		}
	}
	if fallback {
		// Same shape as the CLI's resolver chain (host fonts, then bundled emoji); research limits, not recommendations.
		system, err := d2fonts.NewSystemFallbackResolver(d2fonts.SystemFallbackLimits{MaxDirectoryEntries: 20000, MaxFiles: 4096, MaxFaces: 8192, MaxRequestedRunes: 100000, MaxCoverageChecks: 10000000, MaxFileBytes: 32 << 20, MaxScannedBytes: 256 << 20, MaxResolvedBytes: 128 << 20})
		if err != nil {
			return fail(err)
		}
		resolver, err := d2fonts.NewBundledFallbackResolver(system, d2fonts.BundledFallbackLimits{MaxRequestedRunes: 100000, MaxBundledBytes: 8 << 20, MaxResolvedBytes: 136 << 20})
		if err != nil {
			return fail(err)
		}
		build.Fonts = &d2scenebuild.FontFallbackOptions{Resolver: resolver, MaxAssets: 64, MaxBytes: 64 << 20, MaxRunesPerText: 100000, MaxTotalRunes: 1000000, MaxCoverageChecks: 50000000, MaxFontFacesPerText: 64, MaxShapingRuns: 100000, MaxShapedGlyphs: 1000000}
	}
	scene, err := d2scenebuild.Build(ctx, target, build)
	if err != nil {
		return fail(fmt.Errorf("scene build: %w", err))
	}
	var walk func(*d2scene.Node, d2scene.Matrix)
	if exporting {
		r.Export = &export{ViewBox: scene.ViewBox, Fonts: map[string]string{}}
	}
	walk = func(n *d2scene.Node, parent d2scene.Matrix) {
		acc := parent.Mul(n.Transform)
		rec := node{ID: n.ID, Kind: fmt.Sprintf("%T", n.Primitive)}
		switch p := n.Primitive.(type) {
		case d2scene.TextRun:
			rec.Text, rec.X, rec.Y, rec.Size, rec.Asset, rec.Glyph = p.Text, p.Origin.X, p.Origin.Y, p.Font.Size, string(p.Font.Asset), len(p.Glyphs)
			for _, g := range p.Glyphs {
				if g.ID == 0 && !g.Empty {
					rec.Notdef++
				}
				if rec.GlyphAssets == nil {
					rec.GlyphAssets = map[string]int{}
				}
				asset := string(g.Asset)
				if asset == "" {
					asset = "(primary)"
				}
				rec.GlyphAssets[asset]++
			}
		case d2scene.Image:
			rec.Asset = string(p.Asset)
		}
		if p, ok := n.Primitive.(d2scene.TextRun); ok && r.Export != nil {
			at := acc.Point(p.Origin)
			fill := ""
			if sp, ok := p.Fill.(d2scene.SolidPaint); ok {
				fill = fmt.Sprintf("rgba(%d,%d,%d,%.3f)", sp.Color.R, sp.Color.G, sp.Color.B, float64(sp.Color.A)/255)
			}
			var advance float64
			var fallbacks []string
			seen := map[string]bool{}
			for _, g := range p.Glyphs {
				advance += g.Advance
				if a := string(g.Asset); a != "" && a != string(p.Font.Asset) && !seen[a] {
					seen[a] = true
					fallbacks = append(fallbacks, a)
				}
			}
			r.Export.Runs = append(r.Export.Runs, exportRun{n.ID, p.Text, at.X, at.Y, p.Font.Size, p.Font.Weight, p.Font.Style, string(p.Font.Asset), fill, acc.A != 1 || acc.D != 1 || acc.B != 0 || acc.C != 0, p.Underline, int(p.Anchor), advance, fallbacks})
		}
		r.Nodes = append(r.Nodes, rec)
		for _, c := range n.Children {
			walk(c, acc)
		}
	}
	walk(scene.Root, d2scene.Matrix{A: 1, D: 1})
	for id, a := range scene.Assets {
		r.Assets[string(id)] = fmt.Sprintf("%T", a)
		if fa, ok := a.(d2scene.FontAsset); ok && r.Export != nil {
			if fontsDir != "" {
				name := strings.ReplaceAll(string(id), ":", "_") + ".font"
				if err := os.WriteFile(filepath.Join(fontsDir, name), fa.Data, 0o644); err != nil {
					return fail(err)
				}
				r.Export.Fonts[string(id)] = name
			} else {
				r.Export.Fonts[string(id)] = base64.StdEncoding.EncodeToString(fa.Data)
			}
		}
	}
	r.Links = len(scene.Links)
	if svg, err := d2svg.Render(target, opts); err != nil {
		r.SvgError = err.Error()
	} else {
		r.SvgBytes, r.SvgPaths = len(svg), bytes.Count(svg, []byte("<path"))
		if r.Export != nil {
			r.Export.SVG = string(svg)
		}
	}
	return r
}
