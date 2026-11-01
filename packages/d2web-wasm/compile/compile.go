// Package compile implements the worker side of spec 0001: a compile request in, a result out, as JSON.
package compile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"testing/fstest"
	"time"

	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2layouts/d2dagrelayout"
	"github.com/d2lang/d2/d2layouts/d2elklayout"
	"github.com/d2lang/d2/d2layouts/d2talalayout"
	"github.com/d2lang/d2/d2lib"
	"github.com/d2lang/d2/d2parser"
	"github.com/d2lang/d2/d2renderers/d2fonts"
	"github.com/d2lang/d2/d2renderers/d2scene"
	"github.com/d2lang/d2/d2renderers/d2scenebuild"
	"github.com/d2lang/d2/d2renderers/d2svg"
	"github.com/d2lang/d2/d2renderers/d2svgimport"
	"github.com/d2lang/d2/d2target"
	"github.com/d2lang/d2/lib/imageasset"
	"github.com/d2lang/d2/lib/log"
	"github.com/d2lang/d2/lib/textmeasure"

	"d2web.local/wasm/scenejson"
)

const ProtocolVersion = 1

type Render struct {
	ThemeID        int64                    `json:"themeId"`
	ThemeOverrides *d2target.ThemeOverrides `json:"themeOverrides,omitempty"`
	Sketch         bool                     `json:"sketch"`
	Pad            int64                    `json:"pad"`
	Scale          float64                  `json:"scale"`
	Center         bool                     `json:"center"`
}

// Budgets arrive fully resolved by the host (packages/d2web/src/request.ts); the worker rejects a request without them.
type Budgets struct {
	MaxNodes        int `json:"maxNodes"`
	MaxPathCommands int `json:"maxPathCommands"`
	Sketch          struct {
		MaxOperationSets int `json:"maxOperationSets"`
		MaxOperations    int `json:"maxOperations"`
		MaxPathCommands  int `json:"maxPathCommands"`
	} `json:"sketch"`
	Links struct {
		MaxRegions     int `json:"maxRegions"`
		MaxStringBytes int `json:"maxStringBytes"`
	} `json:"links"`
	SVGImport d2scenebuild.SVGImportBudget `json:"-"`
	SVGRaw    map[string]int               `json:"svgImport"`
}

type Request struct {
	V        int               `json:"v"`
	Type     string            `json:"type"`
	ID       int               `json:"id"`
	Revision int               `json:"revision"`
	Files    map[string]string `json:"files"`
	Entry    string            `json:"entry"`
	Layout   string            `json:"layout"`
	Render   Render            `json:"render"`
	Budgets  Budgets           `json:"budgets"`
	Boards   json.RawMessage   `json:"boards"`
}

type Diagnostic struct {
	Severity string `json:"severity"`
	Message  string `json:"message"`
	Board    string `json:"board,omitempty"`
	File     string `json:"file,omitempty"`
	Range    *struct {
		Start int `json:"start"`
		End   int `json:"end"`
	} `json:"range,omitempty"`
}

type Board struct {
	Path        string          `json:"path"`
	Scene       json.RawMessage `json:"scene"`
	Association *Association    `json:"association"`
}

type Error struct {
	Code        string       `json:"code"`
	Message     string       `json:"message"`
	Diagnostics []Diagnostic `json:"diagnostics"`
}

type Result struct {
	V           int               `json:"v"`
	Type        string            `json:"type"`
	ID          int               `json:"id"`
	Revision    int               `json:"revision"`
	Millis      float64           `json:"millis"`
	Available   []string          `json:"available"`
	Boards      []Board           `json:"boards,omitempty"`
	Fonts       map[string][]byte `json:"fonts,omitempty"` // by asset ID, deduplicated across boards; base64 in JSON
	Error       *Error            `json:"error,omitempty"`
	Diagnostics []Diagnostic      `json:"diagnostics"`
	Echo        struct {
		Layout string `json:"layout"`
		Render Render `json:"render"`
	} `json:"echo"`
}

// Patched is set to "true" at link time (-ldflags -X) by mise run build when the D2 checkout carries docs/upstream patches (spec 0003 section 4).
var Patched string

// Ready is the worker's first message.
func Ready() []byte {
	out, _ := json.Marshal(map[string]any{"v": ProtocolVersion, "type": "ready", "d2": "0.9.0", "engines": []string{"tala", "dagre", "elk"}, "sceneVersion": scenejson.Version, "patched": Patched == "true"})
	return out
}

type offline struct{}

func (offline) RoundTrip(*http.Request) (*http.Response, error) { return nil, errors.New("offline") }

// Handle runs one compile request. Failure of any kind returns a result with an error and no boards.
func Handle(ctx context.Context, raw []byte) []byte {
	start := time.Now()
	var req Request
	res := Result{V: ProtocolVersion, Type: "result", Available: []string{}, Diagnostics: []Diagnostic{}}
	if err := json.Unmarshal(raw, &req); err != nil {
		res.Error = &Error{Code: "internal", Message: "malformed request: " + err.Error(), Diagnostics: []Diagnostic{}}
	} else {
		res.ID, res.Revision = req.ID, req.Revision
		res.Echo.Layout, res.Echo.Render = req.Layout, req.Render
		run(ctx, &req, &res)
	}
	res.Millis = float64(time.Since(start).Microseconds()) / 1000
	if res.Error != nil {
		res.Boards, res.Fonts = nil, nil
	}
	out, err := json.Marshal(res)
	if err != nil {
		out, _ = json.Marshal(Result{V: ProtocolVersion, Type: "result", ID: req.ID, Revision: req.Revision, Available: []string{}, Diagnostics: []Diagnostic{},
			Error: &Error{Code: "internal", Message: err.Error(), Diagnostics: []Diagnostic{}}})
	}
	return out
}

func fail(res *Result, code, message string, diagnostics []Diagnostic) {
	if diagnostics == nil {
		diagnostics = []Diagnostic{}
	}
	res.Error = &Error{Code: code, Message: message, Diagnostics: diagnostics}
}

func run(ctx context.Context, req *Request, res *Result) {
	if req.V != ProtocolVersion || req.Type != "compile" {
		fail(res, "internal", fmt.Sprintf("unsupported message v=%d type=%q", req.V, req.Type), nil)
		return
	}
	source, ok := req.Files[req.Entry]
	if !ok {
		fail(res, "internal", "entry is not among the files", nil)
		return
	}
	if req.Layout != "tala" && req.Layout != "dagre" && req.Layout != "elk" {
		fail(res, "internal", "unknown layout engine "+req.Layout, nil)
		return
	}
	if req.Budgets.MaxNodes <= 0 || req.Budgets.MaxPathCommands <= 0 {
		fail(res, "internal", "budgets are required", nil)
		return
	}
	fsys := fstest.MapFS{}
	for name, text := range req.Files {
		fsys[name] = &fstest.MapFile{Data: []byte(text)}
	}
	ruler, err := textmeasure.NewRuler()
	if err != nil {
		fail(res, "internal", err.Error(), nil)
		return
	}
	ctx = log.WithDefault(ctx)
	opts := &d2svg.RenderOpts{Pad: &req.Render.Pad, Scale: &req.Render.Scale, Center: &req.Render.Center, ThemeID: &req.Render.ThemeID, ThemeOverrides: req.Render.ThemeOverrides, Sketch: &req.Render.Sketch}
	layout := req.Layout
	var target *d2target.Diagram
	var graph *d2graph.Graph
	func() {
		// D2 layout code can panic on odd input (a recovered oracle panic was seen in research); report it as a layout error.
		defer func() {
			if r := recover(); r != nil {
				fail(res, "layout", fmt.Sprint("panic: ", r), nil)
			}
		}()
		target, graph, err = d2lib.Compile(ctx, source, &d2lib.CompileOptions{
			InputPath: req.Entry, FS: fsys, Ruler: ruler, Layout: &layout, UTF16Pos: true,
			LayoutResolver: func(name string) (d2graph.LayoutGraph, error) {
				return func(ctx context.Context, g *d2graph.Graph) error {
					switch name {
					case "dagre":
						return d2dagrelayout.Layout(ctx, g, nil)
					case "elk":
						return d2elklayout.Layout(ctx, g, nil)
					}
					return d2talalayout.Layout(ctx, g, &d2talalayout.Options{Seeds: []int64{1}, MaxConcurrency: 1})
				}, nil
			},
			RouterResolver: func(string) (d2graph.RouteEdges, error) { return d2talalayout.RouteEdges, nil },
		}, opts)
	}()
	if res.Error != nil {
		return
	}
	if err != nil {
		fail(res, "compile", firstLine(err.Error()), diagnostics(err))
		return
	}
	diagrams := map[string]*d2target.Diagram{}
	graphs := map[string]*d2graph.Graph{}
	var walk func(string, *d2target.Diagram, *d2graph.Graph)
	walk = func(path string, d *d2target.Diagram, g *d2graph.Graph) {
		diagrams[path], graphs[path] = d, g
		for _, group := range []struct {
			name   string
			boards []*d2target.Diagram
			graphs []*d2graph.Graph
		}{{"layers", d.Layers, g.Layers}, {"scenarios", d.Scenarios, g.Scenarios}, {"steps", d.Steps, g.Steps}} {
			for i, child := range group.boards {
				walk(path+"/"+group.name+"/"+child.Name, child, group.graphs[i])
			}
		}
	}
	walk("", target, graph)
	for path := range diagrams {
		res.Available = append(res.Available, path)
	}
	sort.Strings(res.Available)
	wanted, err := wantedBoards(req.Boards, res.Available)
	if err != nil {
		fail(res, "compile", err.Error(), nil)
		return
	}
	res.Fonts = map[string][]byte{}
	fallback := &consumerResolver{missing: map[rune]struct{}{}}
	for _, path := range wanted {
		d := diagrams[path]
		leaf := *d
		leaf.Layers, leaf.Scenarios, leaf.Steps = nil, nil, nil
		doc, err := build(ctx, req, opts, &leaf, fallback)
		if err != nil {
			code := "internal"
			if strings.Contains(err.Error(), "budget") || strings.Contains(err.Error(), "exceed") || strings.Contains(err.Error(), "limit") {
				code = "budget" // shortcut: the builder has no typed budget error; matched by message, replace when D2 exposes one
			}
			fail(res, code, fmt.Sprintf("board %q: %v", path, err), nil)
			return
		}
		data, fonts, err := scenejson.Encode(doc)
		if err != nil {
			fail(res, "internal", err.Error(), nil)
			return
		}
		for id, bytes := range fonts {
			res.Fonts[string(id)] = bytes
		}
		assoc := associate(graphs[path], doc)
		res.Boards = append(res.Boards, Board{Path: path, Scene: data, Association: assoc})
		res.Diagnostics = append(res.Diagnostics, missingGlyphDiagnostics(path, fallback.uncovered(), assoc.Objects)...)
	}
}

func build(ctx context.Context, req *Request, opts *d2svg.RenderOpts, leaf *d2target.Diagram, fallback *consumerResolver) (*d2scene.Document, error) {
	// BaseDir is explicit because a browser has no working directory (os.Getwd is not implemented on js).
	// Offline: remote images become the builder's placeholder, and files in the virtual filesystem are not readable as images yet.
	resolver, err := imageasset.New(imageasset.Options{BaseDir: "/", HTTPClient: &http.Client{Transport: offline{}}, Limits: imageasset.Limits{
		MaxFetchedBytes: 1 << 22, MaxEncodedBytes: 1 << 22, MaxDecompressedBytes: 1 << 22, MaxSVGBytes: 1 << 20,
		MaxDecodedWidth: 4096, MaxDecodedHeight: 4096, MaxDecodedPixels: 1 << 24,
		MaxAssets: 256, MaxCumulativeEncodedBytes: 32 << 20, MaxCumulativeDecodedBytes: 128 << 20,
	}})
	if err != nil {
		return nil, err
	}
	b := req.Budgets
	svg := b.SVGRaw
	var fonts *d2scenebuild.FontFallbackOptions
	fontsMu.Lock()
	listed := len(faces) > 0
	fontsMu.Unlock()
	if listed || emojiSupplied() { // no consumer fonts and no emoji: the builder's default (no fallback resolution) is unchanged
		// shortcut: fixed ceilings (64 faces, 256 MiB); expose in Budgets when a consumer needs more.
		var resolver d2fonts.FallbackResolver = fallback
		if emojiSupplied() { // D2's trusted emoji path answers first; the consumer's faces take what it does not cover
			bundled, err := d2fonts.NewBundledFallbackResolver(fallback, d2fonts.BundledFallbackLimits{MaxRequestedRunes: 1 << 20, MaxBundledBytes: 64 << 20, MaxResolvedBytes: 256 << 20})
			if err != nil {
				return nil, err
			}
			resolver = bundled
		}
		fonts = &d2scenebuild.FontFallbackOptions{Resolver: resolver, MaxAssets: 64, MaxBytes: 256 << 20}
	}
	return d2scenebuild.Build(ctx, leaf, d2scenebuild.Options{
		Fonts: fonts,
		Pad:   opts.Pad, Scale: opts.Scale, Center: opts.Center, ThemeID: opts.ThemeID, ThemeOverrides: opts.ThemeOverrides, Sketch: req.Render.Sketch,
		MaxNodes: b.MaxNodes, MaxPathCommands: b.MaxPathCommands,
		SketchBudget: d2scenebuild.SketchBudget{MaxOperationSets: b.Sketch.MaxOperationSets, MaxOperations: b.Sketch.MaxOperations, MaxPathCommands: b.Sketch.MaxPathCommands},
		LinkBudget:   d2scenebuild.LinkBudget{MaxRegions: b.Links.MaxRegions, MaxStringBytes: b.Links.MaxStringBytes},
		Assets: &d2scenebuild.AssetOptions{Resolver: resolver,
			// shortcut: SVG import limits are fixed research values; expose in Budgets when a consumer needs them.
			SVGImportLimits: d2svgimport.Limits{MaxBytes: 1 << 20, MaxDepth: 64, MaxElements: 10000, MaxAttributes: 50000, MaxAttributeBytes: 1 << 20, MaxPathCommands: 100000, MaxTransformFunctions: 10000, MaxUseDepth: 8, MaxResources: 1000},
			SVGImportBudget: d2scenebuild.SVGImportBudget{MaxSourceBytes: svg["maxSourceBytes"], MaxElements: svg["maxElements"], MaxAttributes: svg["maxAttributes"], MaxAttributeBytes: svg["maxAttributeBytes"],
				MaxPathCommands: svg["maxPathCommands"], MaxTransformFunctions: svg["maxTransformFunctions"], MaxDeclaredResources: svg["maxDeclaredResources"], MaxExpandedUseInstances: svg["maxExpandedUseInstances"]},
		},
	})
}

func wantedBoards(raw json.RawMessage, available []string) ([]string, error) {
	var all string
	if json.Unmarshal(raw, &all) == nil && all == "all" {
		return available, nil
	}
	var list []string
	if err := json.Unmarshal(raw, &list); err != nil || len(list) == 0 {
		return nil, errors.New("boards must be 'all' or a non-empty list")
	}
	have := map[string]bool{}
	for _, p := range available {
		have[p] = true
	}
	for _, p := range list {
		if !have[p] {
			return nil, fmt.Errorf("unknown board %q", p)
		}
	}
	return list, nil
}

func firstLine(s string) string { return strings.SplitN(s, "\n", 2)[0] }

func diagnostics(err error) []Diagnostic {
	var pe *d2parser.ParseError
	if !errors.As(err, &pe) {
		return []Diagnostic{{Severity: "error", Message: firstLine(err.Error())}}
	}
	out := []Diagnostic{}
	for _, e := range pe.Errors {
		d := Diagnostic{Severity: "error", Message: e.Message, File: e.Range.Path}
		d.Range = &struct {
			Start int `json:"start"`
			End   int `json:"end"`
		}{e.Range.Start.Byte, e.Range.End.Byte}
		out = append(out, d)
	}
	return out
}
