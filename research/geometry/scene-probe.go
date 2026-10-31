// This investigation probe uses upstream D2 types; its JSON is not a public bridge schema.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

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

func main() {
	if err := probe(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func probe() error {
	if len(os.Args) != 2 {
		return fmt.Errorf("expected D2 source argument")
	}
	ctx, cancel := context.WithTimeout(log.WithDefault(context.Background()), 30*time.Second)
	defer cancel()
	ruler, err := textmeasure.NewRuler()
	if err != nil {
		return err
	}
	layout, pad, scale, theme := "tala", int64(0), 1.0, int64(0)
	options := &d2svg.RenderOpts{Pad: &pad, Scale: &scale, ThemeID: &theme}
	target, _, err := d2lib.Compile(ctx, os.Args[1], &d2lib.CompileOptions{
		InputPath: "geometry.d2", Ruler: ruler, Layout: &layout,
		LayoutResolver: func(engine string) (d2graph.LayoutGraph, error) {
			if engine != "tala" {
				return nil, fmt.Errorf("probe only supports TALA")
			}
			return func(ctx context.Context, graph *d2graph.Graph) error {
				return d2talalayout.Layout(ctx, graph, &d2talalayout.Options{Seeds: []int64{1}, MaxConcurrency: 1})
			}, nil
		},
		RouterResolver: func(string) (d2graph.RouteEdges, error) { return d2talalayout.RouteEdges, nil },
	}, options)
	if err != nil {
		return err
	}
	scene, err := d2scenebuild.Build(ctx, target, d2scenebuild.Options{
		Pad: options.Pad, Scale: options.Scale, Center: options.Center,
		ThemeID: options.ThemeID, ThemeOverrides: options.ThemeOverrides,
		MaxNodes: 10000, MaxPathCommands: 100000,
	})
	if err != nil {
		return err
	}
	type nodeKind struct {
		ID   string `json:"id"`
		Kind string `json:"kind"`
	}
	var nodes []nodeKind
	var visit func(*d2scene.Node)
	visit = func(node *d2scene.Node) {
		nodes = append(nodes, nodeKind{node.ID, fmt.Sprintf("%T", node.Primitive)})
		for _, child := range node.Children {
			visit(child)
		}
	}
	visit(scene.Root)
	webRoot, err := geometryNode(scene.Root)
	if err != nil {
		return err
	}
	if len(scene.Assets) != 0 || len(scene.Links) != 0 {
		return fmt.Errorf("unsupported geometry assets or links")
	}
	return json.NewEncoder(os.Stdout).Encode(struct {
		Target   *d2target.Diagram `json:"target"`
		Scene    *d2scene.Document `json:"scene"`
		Nodes    []nodeKind        `json:"nodes"`
		WebScene geometryScene     `json:"webScene"`
	}{target, scene, nodes, geometryScene{scene, webRoot}})
}

type geometryScene struct {
	*d2scene.Document
	Root *geometrySceneNode
}

// shortcut: only the proven geometry subset is serialized; extend with native parity cases.
type geometrySceneNode struct {
	*d2scene.Node
	Kind     string
	Children []*geometrySceneNode
}

func geometryNode(node *d2scene.Node) (*geometrySceneNode, error) {
	if node.Clip != nil || node.Mask != nil || len(node.Filters) != 0 || len(node.Animations) != 0 || node.Blend != d2scene.BlendNormal {
		return nil, fmt.Errorf("unsupported geometry effects on %q", node.ID)
	}
	result := &geometrySceneNode{Node: node}
	var fill d2scene.Paint
	var stroke *d2scene.Stroke
	switch primitive := node.Primitive.(type) {
	case nil:
		result.Kind = "group"
	case d2scene.Rect:
		result.Kind, fill, stroke = "rect", primitive.Fill, primitive.Stroke
	case d2scene.Ellipse:
		result.Kind, fill, stroke = "ellipse", primitive.Fill, primitive.Stroke
	case d2scene.Path:
		result.Kind, fill, stroke = "path", primitive.Fill, primitive.Stroke
		for _, command := range primitive.Commands {
			if command.Kind != d2scene.MoveCommand && command.Kind != d2scene.LineCommand && command.Kind != d2scene.CloseCommand {
				return nil, fmt.Errorf("unsupported geometry path command %d", command.Kind)
			}
		}
	default:
		return nil, fmt.Errorf("unsupported geometry primitive %T", primitive)
	}
	paints := []d2scene.Paint{fill}
	if stroke != nil {
		paints = append(paints, stroke.Paint)
	}
	for _, paint := range paints {
		if paint != nil {
			if _, ok := paint.(d2scene.SolidPaint); !ok {
				return nil, fmt.Errorf("unsupported geometry paint %T", paint)
			}
		}
	}
	for _, child := range node.Children {
		encoded, err := geometryNode(child)
		if err != nil {
			return nil, err
		}
		result.Children = append(result.Children, encoded)
	}
	return result, nil
}
