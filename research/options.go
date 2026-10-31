// Investigation probe: do render options (theme id, sketch) reach the built scene? Arguments: source, theme id, sketch, pad.
// Output is a summary, not a bridge schema.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2layouts/d2talalayout"
	"github.com/d2lang/d2/d2lib"
	"github.com/d2lang/d2/d2renderers/d2scene"
	"github.com/d2lang/d2/d2renderers/d2scenebuild"
	"github.com/d2lang/d2/d2renderers/d2svg"
	"github.com/d2lang/d2/lib/log"
	"github.com/d2lang/d2/lib/textmeasure"
)

type summary struct {
	Fills    []string `json:"fills"`
	Commands int      `json:"commands"`
	Nodes    int      `json:"nodes"`
}

func main() {
	if len(os.Args) != 4 {
		fmt.Fprintln(os.Stderr, "expected source, theme id and sketch")
		os.Exit(1)
	}
	theme, err := strconv.ParseInt(os.Args[2], 10, 64)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	sketch := os.Args[3] == "true"
	ctx, cancel := context.WithTimeout(log.WithDefault(context.Background()), 30*time.Second)
	defer cancel()
	ruler, err := textmeasure.NewRuler()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	layout, pad, scale := "tala", int64(0), 1.0
	options := &d2svg.RenderOpts{Pad: &pad, Scale: &scale, ThemeID: &theme, Sketch: &sketch}
	target, _, err := d2lib.Compile(ctx, os.Args[1], &d2lib.CompileOptions{
		InputPath: "options.d2", Ruler: ruler, Layout: &layout,
		LayoutResolver: func(string) (d2graph.LayoutGraph, error) {
			return func(ctx context.Context, g *d2graph.Graph) error {
				return d2talalayout.Layout(ctx, g, &d2talalayout.Options{Seeds: []int64{1}, MaxConcurrency: 1})
			}, nil
		},
		RouterResolver: func(string) (d2graph.RouteEdges, error) { return d2talalayout.RouteEdges, nil },
	}, options)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	scene, err := d2scenebuild.Build(ctx, target, d2scenebuild.Options{
		Pad: options.Pad, Scale: options.Scale, ThemeID: options.ThemeID, Sketch: sketch, MaxNodes: 10000, MaxPathCommands: 1000000,
		SketchBudget: d2scenebuild.SketchBudget{MaxOperationSets: 100000, MaxOperations: 1000000, MaxPathCommands: 1000000},
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var s summary
	var visit func(*d2scene.Node)
	visit = func(n *d2scene.Node) {
		s.Nodes++
		switch p := n.Primitive.(type) {
		case d2scene.Rect:
			if f, ok := p.Fill.(d2scene.SolidPaint); ok {
				s.Fills = append(s.Fills, fmt.Sprintf("%d,%d,%d", f.Color.R, f.Color.G, f.Color.B))
			}
		case d2scene.Path:
			s.Commands += len(p.Commands)
		}
		for _, c := range n.Children {
			visit(c)
		}
	}
	visit(scene.Root)
	json.NewEncoder(os.Stdout).Encode(s)
}
