// Research output is diagnostic and intentionally not a public library contract.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing/fstest"
	"time"

	"github.com/d2lang/d2/d2ast"
	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2layouts/d2talalayout"
	"github.com/d2lang/d2/d2lib"
	"github.com/d2lang/d2/d2renderers/d2scene"
	"github.com/d2lang/d2/d2renderers/d2scenebuild"
	"github.com/d2lang/d2/d2renderers/d2svg"
	"github.com/d2lang/d2/d2target"
	"github.com/d2lang/d2/lib/log"
	"github.com/d2lang/d2/lib/textmeasure"
)

type input struct {
	Entry string            `json:"entry"`
	Files map[string]string `json:"files"`
}

type reference struct {
	Path  string      `json:"path"`
	Range d2ast.Range `json:"range"`
}

type object struct {
	ID           string      `json:"id"`
	References   []reference `json:"references"`
	Label        string      `json:"label"`
	LabelSource  *reference  `json:"labelSource"`
	Fill         string      `json:"fill"`
	FillSource   *reference  `json:"fillSource"`
	Stroke       string      `json:"stroke"`
	StrokeSource *reference  `json:"strokeSource"`
}

type sceneNode struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
}

type board struct {
	Path       []string    `json:"path"`
	Objects    []object    `json:"objects"`
	Edges      []object    `json:"edges"`
	TargetIDs  []string    `json:"targetIDs"`
	Scene      []sceneNode `json:"scene"`
	SceneError string      `json:"sceneError,omitempty"`
}

func source(key *d2ast.Key) *reference {
	if key == nil {
		return nil
	}
	return &reference{key.Range.Path, key.Range}
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) != 2 {
		return fmt.Errorf("expected JSON workspace argument")
	}
	var request input
	if err := json.Unmarshal([]byte(os.Args[1]), &request); err != nil {
		return err
	}
	text, ok := request.Files[request.Entry]
	if !ok {
		return fmt.Errorf("entry missing")
	}
	files := fstest.MapFS{}
	for path, text := range request.Files {
		files[path] = &fstest.MapFile{Data: []byte(text)}
	}
	ctx, cancel := context.WithTimeout(log.WithDefault(context.Background()), 30*time.Second)
	defer cancel()
	ruler, err := textmeasure.NewRuler()
	if err != nil {
		return err
	}
	layout, pad, scale, theme := "tala", int64(0), 1.0, int64(0)
	opts := &d2svg.RenderOpts{Pad: &pad, Scale: &scale, ThemeID: &theme}
	target, graph, err := d2lib.Compile(ctx, text, &d2lib.CompileOptions{
		FS: files, InputPath: request.Entry, Ruler: ruler, Layout: &layout, UTF16Pos: true,
		LayoutResolver: func(engine string) (d2graph.LayoutGraph, error) {
			if engine != "tala" {
				return nil, fmt.Errorf("unsupported engine %s", engine)
			}
			return func(ctx context.Context, g *d2graph.Graph) error {
				return d2talalayout.Layout(ctx, g, &d2talalayout.Options{Seeds: []int64{1}, MaxConcurrency: 1})
			}, nil
		},
		RouterResolver: func(string) (d2graph.RouteEdges, error) { return d2talalayout.RouteEdges, nil },
	}, opts)
	if err != nil {
		return err
	}
	var result []board
	var visit func(*d2graph.Graph, *d2target.Diagram) error
	visit = func(g *d2graph.Graph, target *d2target.Diagram) error {
		b := board{Path: g.IDA()}
		for _, obj := range g.Objects {
			o := object{ID: obj.AbsID(), Label: obj.Label.Value, LabelSource: source(obj.Label.MapKey)}
			for _, ref := range obj.References {
				if ref.Key != nil {
					o.References = append(o.References, reference{ref.Key.Range.Path, ref.Key.Range})
				}
			}
			if obj.Style.Fill != nil {
				o.Fill, o.FillSource = obj.Style.Fill.Value, source(obj.Style.Fill.MapKey)
			}
			if obj.Style.Stroke != nil {
				o.Stroke, o.StrokeSource = obj.Style.Stroke.Value, source(obj.Style.Stroke.MapKey)
			}
			b.Objects = append(b.Objects, o)
		}
		for _, edge := range g.Edges {
			e := object{ID: edge.AbsID(), Label: edge.Label.Value}
			for _, ref := range edge.References {
				if s := source(ref.MapKey); s != nil {
					e.References = append(e.References, *s)
				}
			}
			b.Edges = append(b.Edges, e)
		}
		for _, shape := range target.Shapes {
			b.TargetIDs = append(b.TargetIDs, shape.ID)
		}
		for _, edge := range target.Connections {
			b.TargetIDs = append(b.TargetIDs, edge.ID)
		}
		// Build every board separately; the builder deliberately rejects board trees.
		flat := *target
		flat.Layers, flat.Scenarios, flat.Steps = nil, nil, nil
		scene, err := d2scenebuild.Build(ctx, &flat, d2scenebuild.Options{
			Pad: opts.Pad, Scale: opts.Scale, ThemeID: opts.ThemeID,
			MaxNodes: 10000, MaxPathCommands: 100000,
			LinkBudget: d2scenebuild.LinkBudget{MaxRegions: 1000, MaxStringBytes: 100000},
		})
		if err != nil {
			b.SceneError = err.Error()
		} else {
			var walk func(*d2scene.Node)
			walk = func(node *d2scene.Node) {
				b.Scene = append(b.Scene, sceneNode{node.ID, fmt.Sprintf("%T", node.Primitive)})
				for _, child := range node.Children {
					walk(child)
				}
			}
			walk(scene.Root)
		}
		result = append(result, b)
		for _, pair := range []struct {
			graphs  []*d2graph.Graph
			targets []*d2target.Diagram
		}{
			{g.Layers, target.Layers}, {g.Scenarios, target.Scenarios}, {g.Steps, target.Steps},
		} {
			if len(pair.graphs) != len(pair.targets) {
				return fmt.Errorf("board counts differ")
			}
			for i, child := range pair.graphs {
				if child.Name != pair.targets[i].Name {
					return fmt.Errorf("board names differ")
				}
				if err := visit(child, pair.targets[i]); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := visit(graph, target); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}
