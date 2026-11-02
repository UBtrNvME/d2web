// Investigation probe for ADR 0011 (images like native D2). Argument: one JSON object {files, entry, serve}.
// It answers three questions without any network:
//  1. Can the D2 compiler list the image links before layout (a preflight), including links that arrive through imports, vars, classes, globs and boards?
//  2. Is that list the set the scene builder asks its resolver for?
//  3. Can a consumer-supplied map of bytes reach the builder through D2's public hook (the resolver's HTTP client), with no patch to D2?
// Output is a summary, not a bridge schema.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"testing/fstest"
	"time"

	"github.com/d2lang/d2/d2compiler"
	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2layouts/d2talalayout"
	"github.com/d2lang/d2/d2lib"
	"github.com/d2lang/d2/d2renderers/d2scenebuild"
	"github.com/d2lang/d2/d2renderers/d2svg"
	"github.com/d2lang/d2/d2renderers/d2svgimport"
	"github.com/d2lang/d2/lib/imageasset"
	"github.com/d2lang/d2/d2target"
	"github.com/d2lang/d2/lib/log"
	"github.com/d2lang/d2/lib/textmeasure"
)

type input struct {
	Files map[string]string `json:"files"`
	Entry string            `json:"entry"`
	Serve map[string]string `json:"serve"`
}

type found struct {
	Board  string `json:"board"`
	Kind   string `json:"kind"`
	ID     string `json:"id"`
	Source string `json:"source"`
}

type output struct {
	PreflightMs float64  `json:"preflightMs"`
	FullMs      float64  `json:"fullMs"`
	Images      []found  `json:"images"`
	Requested   []string `json:"requested"`
	Assets      []string `json:"assets"`
	Error       string   `json:"error,omitempty"`
}

// recorder is the resolver's HTTP client: it notes every request and answers only from the consumer's map.
type recorder struct {
	serve map[string]string
	seen  map[string]bool
}

func (r *recorder) RoundTrip(req *http.Request) (*http.Response, error) {
	url := req.URL.String()
	r.seen[url] = true
	body, ok := r.serve[url]
	if !ok {
		return nil, errors.New("not supplied by the consumer")
	}
	return &http.Response{StatusCode: 200, Status: "200 OK", Header: http.Header{"Content-Type": {"image/svg+xml"}}, Body: io.NopCloser(bytes.NewReader([]byte(body))), ContentLength: int64(len(body)), Request: req}, nil
}

func walk(g *d2graph.Graph, board string, out *[]found) {
	for _, o := range g.Objects {
		if o.Icon != nil {
			kind := "icon"
			if o.Shape.Value == "image" {
				kind = "image"
			}
			*out = append(*out, found{board, kind, o.AbsID(), o.Icon.String()})
		}
	}
	for _, e := range g.Edges {
		if e.Icon != nil {
			*out = append(*out, found{board, "edge-icon", e.AbsID(), e.Icon.String()})
		}
	}
	for _, group := range []struct {
		kind  string
		items []*d2graph.Graph
	}{{"layers", g.Layers}, {"scenarios", g.Scenarios}, {"steps", g.Steps}} {
		for _, c := range group.items {
			name := group.kind + "." + c.Name
			if board != "" {
				name = board + "." + name
			}
			walk(c, name, out)
		}
	}
}

var out output

func fail(err error) {
	out.Error = err.Error()
	json.NewEncoder(os.Stdout).Encode(out)
	os.Exit(0)
}

func main() {
	var in input
	if len(os.Args) != 2 || json.Unmarshal([]byte(os.Args[1]), &in) != nil {
		fmt.Fprintln(os.Stderr, "expected one JSON argument {files, entry, serve}")
		os.Exit(1)
	}
	fsys := fstest.MapFS{}
	for name, text := range in.Files {
		fsys[name] = &fstest.MapFile{Data: []byte(text)}
	}
	start := time.Now()
	g, _, err := d2compiler.Compile(in.Entry, strings.NewReader(in.Files[in.Entry]), &d2compiler.CompileOptions{UTF16Pos: true, FS: fsys})
	if err != nil {
		fail(err)
	}
	walk(g, "", &out.Images)
	out.PreflightMs = float64(time.Since(start).Microseconds()) / 1000
	sort.Slice(out.Images, func(i, j int) bool {
		a, b := out.Images[i], out.Images[j]
		return a.Board+"\x00"+a.ID+"\x00"+a.Kind < b.Board+"\x00"+b.ID+"\x00"+b.Kind
	})

	ctx, cancel := context.WithTimeout(log.WithDefault(context.Background()), 60*time.Second)
	defer cancel()
	ruler, err := textmeasure.NewRuler()
	if err != nil {
		fail(err)
	}
	layout, pad, scale, theme := "tala", int64(0), 1.0, int64(0)
	rec := &recorder{serve: in.Serve, seen: map[string]bool{}}
	resolver, err := imageasset.New(imageasset.Options{BaseDir: "/", HTTPClient: &http.Client{Transport: rec}, Limits: imageasset.Limits{
		MaxFetchedBytes: 1 << 22, MaxEncodedBytes: 1 << 22, MaxDecompressedBytes: 1 << 22, MaxSVGBytes: 1 << 20,
		MaxDecodedWidth: 4096, MaxDecodedHeight: 4096, MaxDecodedPixels: 1 << 24,
		MaxAssets: 256, MaxCumulativeEncodedBytes: 32 << 20, MaxCumulativeDecodedBytes: 128 << 20,
	}})
	if err != nil {
		fail(err)
	}
	start = time.Now()
	target, _, err := d2lib.Compile(ctx, in.Files[in.Entry], &d2lib.CompileOptions{
		InputPath: in.Entry, FS: fsys, Ruler: ruler, Layout: &layout, UTF16Pos: true,
		LayoutResolver: func(string) (d2graph.LayoutGraph, error) {
			return func(ctx context.Context, g *d2graph.Graph) error {
				return d2talalayout.Layout(ctx, g, &d2talalayout.Options{Seeds: []int64{1}, MaxConcurrency: 1})
			}, nil
		},
		RouterResolver: func(string) (d2graph.RouteEdges, error) { return d2talalayout.RouteEdges, nil },
	}, &d2svg.RenderOpts{Pad: &pad, Scale: &scale, ThemeID: &theme})
	if err != nil {
		fail(err)
	}
	// The builder takes one board at a time, as the worker does: build the root and every nested board on its own.
	buildOpts := d2scenebuild.Options{
		Pad: &pad, Scale: &scale, ThemeID: &theme, MaxNodes: 10000, MaxPathCommands: 1000000,
		SketchBudget: d2scenebuild.SketchBudget{MaxOperationSets: 100000, MaxOperations: 1000000, MaxPathCommands: 1000000},
		Assets: &d2scenebuild.AssetOptions{Resolver: resolver,
			SVGImportLimits: d2svgimport_limits(),
			SVGImportBudget: d2scenebuild.SVGImportBudget{MaxSourceBytes: 1 << 22, MaxElements: 100000, MaxAttributes: 500000, MaxAttributeBytes: 1 << 22, MaxPathCommands: 1000000, MaxTransformFunctions: 100000, MaxDeclaredResources: 10000, MaxExpandedUseInstances: 100000}},
	}
	assets := map[string]bool{}
	var build func(d *d2target.Diagram)
	build = func(d *d2target.Diagram) {
		leaf := *d
		leaf.Layers, leaf.Scenarios, leaf.Steps = nil, nil, nil
		scene, err := d2scenebuild.Build(ctx, &leaf, buildOpts)
		if err != nil {
			fail(err)
		}
		for id := range scene.Assets {
			if strings.HasPrefix(string(id), "image:") {
				assets[string(id)] = true
			}
		}
		for _, group := range [][]*d2target.Diagram{d.Layers, d.Scenarios, d.Steps} {
			for _, c := range group {
				build(c)
			}
		}
	}
	build(target)
	out.FullMs = float64(time.Since(start).Microseconds()) / 1000
	for u := range rec.seen {
		out.Requested = append(out.Requested, u)
	}
	sort.Strings(out.Requested)
	for id := range assets {
		out.Assets = append(out.Assets, id)
	}
	sort.Strings(out.Assets)
	json.NewEncoder(os.Stdout).Encode(out)
}

// The same fixed research limits the worker uses for SVG import (packages/d2web-wasm/compile/compile.go).
func d2svgimport_limits() d2svgimport.Limits {
	return d2svgimport.Limits{MaxBytes: 1 << 20, MaxDepth: 64, MaxElements: 10000, MaxAttributes: 50000, MaxAttributeBytes: 1 << 20, MaxPathCommands: 100000, MaxTransformFunctions: 10000, MaxUseDepth: 8, MaxResources: 1000}
}
