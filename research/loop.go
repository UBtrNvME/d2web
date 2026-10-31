// Diagnostic experiment for R6: compile D2 source in memory with TALA and report node boxes and edge endpoints, so a browser
// page can run a measure -> request size -> recompile loop. Not a proposed API.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing/fstest"
	"time"

	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2layouts/d2dagrelayout"
	"github.com/d2lang/d2/d2layouts/d2elklayout"
	"github.com/d2lang/d2/d2layouts/d2talalayout"
	"github.com/d2lang/d2/d2lib"
	"github.com/d2lang/d2/lib/log"
	"github.com/d2lang/d2/lib/textmeasure"
)

// serve is set by research-loop-serve.go on js/wasm.
var serve func()

type box struct {
	X, Y, Width, Height float64
}
type edge struct {
	ID    string       `json:"id"`
	Route [][2]float64 `json:"route"`
}
type result struct {
	Error string         `json:"error,omitempty"`
	Nodes map[string]box `json:"nodes"`
	Edges []edge         `json:"edges"`
	// Millis is the compile and layout time inside the instance, excluding instantiation.
	Millis float64 `json:"millis"`
}

func main() {
	// --serve is provided only by the js/wasm build (research-loop-serve.go).
	if len(os.Args) == 2 && os.Args[1] == "--serve" && serve != nil {
		serve()
	}
	var in struct {
		Source string `json:"source"`
		Layout string `json:"layout"`
	}
	if len(os.Args) != 2 || json.Unmarshal([]byte(os.Args[1]), &in) != nil {
		fmt.Fprintln(os.Stderr, "expected JSON {source}")
		os.Exit(1)
	}
	json.NewEncoder(os.Stdout).Encode(compileSource(in.Source, in.Layout))
}

// compileSource lays the board out with the named engine (tala by default; dagre and elk run in an embedded JS runtime).
func compileSource(source, engine string) result {
	start := time.Now()
	r := result{Nodes: map[string]box{}, Edges: []edge{}}
	ctx := log.WithDefault(context.Background())
	ruler, err := textmeasure.NewRuler()
	if err != nil {
		r.Error = err.Error()
	} else {
		layout := engine
		if layout == "" {
			layout = "tala"
		}
		d, _, err := d2lib.Compile(ctx, source, &d2lib.CompileOptions{
			InputPath: "main.d2", FS: fstest.MapFS{}, Ruler: ruler, Layout: &layout,
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
		}, nil)
		if err != nil {
			r.Error = strings.SplitN(err.Error(), "\n", 2)[0]
		} else {
			for _, s := range d.Shapes {
				r.Nodes[s.ID] = box{float64(s.Pos.X), float64(s.Pos.Y), float64(s.Width), float64(s.Height)}
			}
			for _, c := range d.Connections {
				e := edge{ID: c.ID}
				for _, p := range c.Route {
					e.Route = append(e.Route, [2]float64{p.X, p.Y})
				}
				r.Edges = append(r.Edges, e)
			}
		}
	}
	r.Millis = float64(time.Since(start).Microseconds()) / 1000
	return r
}
