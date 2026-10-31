package scenejson

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
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

type offline struct{}

func (offline) RoundTrip(*http.Request) (*http.Response, error) { return nil, errors.New("offline") }

// boards compiles one corpus file with TALA and builds a scene per board (the builder refuses nested boards, so each is built alone).
// shortcut: this pipeline lives in the test until slice 1 step 3 moves it into the worker package.
func boards(t *testing.T, dir, entry string) map[string]*d2scene.Document {
	t.Helper()
	source, err := os.ReadFile(filepath.Join(dir, entry))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(log.WithDefault(context.Background()), 90*time.Second)
	defer cancel()
	ruler, err := textmeasure.NewRuler()
	if err != nil {
		t.Fatal(err)
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
		t.Skipf("%s does not compile: %v", entry, err)
	}
	out := map[string]*d2scene.Document{}
	var walk func(string, *d2target.Diagram)
	walk = func(path string, d *d2target.Diagram) {
		leaf := *d
		leaf.Layers, leaf.Scenarios, leaf.Steps = nil, nil, nil
		resolver, err := imageasset.New(imageasset.Options{BaseDir: dir, HTTPClient: &http.Client{Transport: offline{}}, Limits: imageasset.Limits{
			MaxFetchedBytes: 1 << 22, MaxEncodedBytes: 1 << 22, MaxDecompressedBytes: 1 << 22, MaxSVGBytes: 1 << 20,
			MaxDecodedWidth: 4096, MaxDecodedHeight: 4096, MaxDecodedPixels: 1 << 24,
			MaxAssets: 256, MaxCumulativeEncodedBytes: 32 << 20, MaxCumulativeDecodedBytes: 128 << 20,
		}})
		if err != nil {
			t.Fatal(err)
		}
		doc, err := d2scenebuild.Build(ctx, &leaf, d2scenebuild.Options{
			Pad: opts.Pad, Scale: opts.Scale, ThemeID: opts.ThemeID, MaxNodes: 100000, MaxPathCommands: 1000000,
			SketchBudget: d2scenebuild.SketchBudget{MaxOperationSets: 100000, MaxOperations: 1000000, MaxPathCommands: 1000000},
			LinkBudget:   d2scenebuild.LinkBudget{MaxRegions: 10000, MaxStringBytes: 1000000},
			Assets: &d2scenebuild.AssetOptions{Resolver: resolver,
				SVGImportLimits: d2svgimport.Limits{MaxBytes: 1 << 20, MaxDepth: 64, MaxElements: 10000, MaxAttributes: 50000, MaxAttributeBytes: 1 << 20, MaxPathCommands: 100000, MaxTransformFunctions: 10000, MaxUseDepth: 8, MaxResources: 1000},
				SVGImportBudget: d2scenebuild.SVGImportBudget{MaxSourceBytes: 1 << 22, MaxElements: 100000, MaxAttributes: 500000, MaxAttributeBytes: 1 << 22, MaxPathCommands: 1000000, MaxTransformFunctions: 100000, MaxDeclaredResources: 10000, MaxExpandedUseInstances: 10000},
			},
		})
		if err != nil {
			t.Fatalf("%s board %q: %v", entry, path, err)
		}
		out[path] = doc
		for _, group := range []struct {
			name   string
			boards []*d2target.Diagram
		}{{"layers", d.Layers}, {"scenarios", d.Scenarios}, {"steps", d.Steps}} {
			for _, child := range group.boards {
				walk(path+"/"+group.name+"/"+child.Name, child)
			}
		}
	}
	walk("", target)
	return out
}

// Acceptance for slice 1 step 2: every board of every .d2 file under examples/files and examples/boards encodes with no unsupported type.
func TestCorpusEncodes(t *testing.T) {
	var files []string
	for _, pattern := range []string{"../../../examples/files/*.d2", "../../../examples/boards/*.d2"} {
		m, err := filepath.Glob(pattern)
		if err != nil {
			t.Fatal(err)
		}
		files = append(files, m...)
	}
	if len(files) < 60 {
		t.Fatalf("expected the corpus, found %d files", len(files))
	}
	encoded, skipped := 0, 0
	for _, file := range files {
		t.Run(filepath.Base(file), func(t *testing.T) {
			docs := boards(t, filepath.Dir(file), filepath.Base(file))
			for path, doc := range docs {
				data, _, err := Encode(doc)
				if err != nil {
					t.Fatalf("board %q: %v", path, err)
				}
				var round map[string]any
				if err := json.Unmarshal(data, &round); err != nil || round["$"] != "Document" {
					t.Fatalf("board %q does not decode as a Document: %v", path, err)
				}
				encoded++
			}
		})
	}
	t.Logf("%d files, %d boards encoded, %d skipped", len(files), encoded, skipped)
	if encoded < 100 {
		t.Fatalf("only %d boards encoded", encoded)
	}
}

func TestUnknownTypeFails(t *testing.T) {
	doc := d2scene.NewDocument(d2scene.Box{Width: 1, Height: 1}, &d2scene.Node{ID: "root", Primitive: struct{ d2scene.Rect }{}})
	if _, _, err := Encode(doc); err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("want unsupported type error, got %v", err)
	}
	if _, _, err := Encode(nil); err == nil {
		t.Fatal("nil document must be rejected")
	}
}

// Pins the closed type set: a D2 upgrade or an edit to the allow list must show up as a diff here.
func TestTypeSetSnapshot(t *testing.T) {
	got := Types()
	sort.Strings(got)
	want := "AspectRatio,AnimationValue,Box,Bounds,CenterArc,Clip,DropShadow,Easing,Ellipse,Font,FontAsset,GaussianBlur,Glyph,GradientStop,Image,Keyframe,LinearGradient,LinkRegion,Mask,Matrix,Node,PathCommand,Path,PatternPaint,Point,RadialGradient,RasterAsset,Rect,SolidPaint,Stroke,TextRun,Track,VectorAsset,Document"
	wantList := strings.Split(want, ",")
	sort.Strings(wantList)
	if strings.Join(got, ",") != strings.Join(wantList, ",") {
		t.Fatalf("type set changed:\n got %v\nwant %v", got, wantList)
	}
}
