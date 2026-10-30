// This investigation probe exports one native D2 text case, including its resolved font bytes.
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2layouts/d2talalayout"
	"github.com/d2lang/d2/d2lib"
	"github.com/d2lang/d2/d2renderers/d2fonts"
	"github.com/d2lang/d2/d2renderers/d2scene"
	"github.com/d2lang/d2/d2renderers/d2scenebuild"
	"github.com/d2lang/d2/d2renderers/d2svg"
	fontlib "github.com/d2lang/d2/lib/font"
	"github.com/d2lang/d2/lib/log"
	"github.com/d2lang/d2/lib/textmeasure"
)

type textRecord struct {
	NodeID string            `json:"nodeID"`
	Run    d2scene.TextRun   `json:"run"`
	Asset  d2scene.FontAsset `json:"asset"`
}

type fontControls struct {
	FullPreEncodedWoff   string `json:"fullPreEncodedWoff"`
	FullTtfConvertedWoff string `json:"fullTtfConvertedWoff"`
}

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
	source, err := os.ReadFile(os.Args[1])
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(log.WithDefault(context.Background()), 30*time.Second)
	defer cancel()
	ruler, err := textmeasure.NewRuler()
	if err != nil {
		return err
	}
	layout, pad, scale, theme := "tala", int64(0), 1.0, int64(0)
	options := &d2svg.RenderOpts{Pad: &pad, Scale: &scale, ThemeID: &theme}
	target, _, err := d2lib.Compile(ctx, string(source), &d2lib.CompileOptions{
		InputPath: "main.d2", Ruler: ruler, Layout: &layout,
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
	var records []textRecord
	var visit func(*d2scene.Node) error
	visit = func(node *d2scene.Node) error {
		if run, ok := node.Primitive.(d2scene.TextRun); ok {
			asset, ok := scene.Assets[run.Font.Asset].(d2scene.FontAsset)
			if !ok || len(asset.Data) == 0 {
				return fmt.Errorf("missing resolved font asset %q", run.Font.Asset)
			}
			records = append(records, textRecord{node.ID, run, asset})
		}
		for _, child := range node.Children {
			if err := visit(child); err != nil {
				return err
			}
		}
		return nil
	}
	if err := visit(scene.Root); err != nil {
		return err
	}
	if len(records) != 3 {
		return fmt.Errorf("found %d text runs, want three labels", len(records))
	}
	svg, err := d2svg.Render(target, options)
	if err != nil {
		return err
	}
	fontSpec := d2fonts.Font{Family: d2fonts.SourceSansPro, Style: d2fonts.FONT_STYLE_BOLD}
	preEncodedWoff, ok := d2fonts.FontEncodings.Lookup(fontSpec)
	if !ok {
		return fmt.Errorf("full pre-encoded bold WOFF is unavailable")
	}
	fullWoffBytes, err := fontlib.Sfnt2Woff(records[0].Asset.Data)
	if err != nil {
		return fmt.Errorf("convert full scene TTF to WOFF: %w", err)
	}
	labels := make(map[string]struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	})
	for _, shape := range target.Shapes {
		if shape.ID == "source" || shape.ID == "target" {
			labels[shape.ID] = struct {
				Width  int `json:"width"`
				Height int `json:"height"`
			}{shape.Text.LabelWidth, shape.Text.LabelHeight}
		}
	}
	return json.NewEncoder(os.Stdout).Encode(struct {
		ViewBox         d2scene.Box  `json:"viewBox"`
		Runs            []textRecord `json:"runs"`
		LabelDimensions map[string]struct {
			Width  int `json:"width"`
			Height int `json:"height"`
		} `json:"labelDimensions"`
		FontControls fontControls `json:"fontControls"`
		NativeSVG    string       `json:"nativeSVG"`
	}{scene.ViewBox, records, labels, fontControls{
		FullPreEncodedWoff:   preEncodedWoff,
		FullTtfConvertedWoff: "data:application/font-woff;base64," + base64.StdEncoding.EncodeToString(fullWoffBytes),
	}, string(svg)})
}
