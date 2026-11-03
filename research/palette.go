// Diagnostic probe for docs/ideas/palette-primitives.md, not a public editing contract.
// Run from imports/d2: go run ../../research/palette.go
package main

import (
	"context"
	"fmt"
	"strings"
	"testing/fstest"

	"github.com/d2lang/d2/d2compiler"
	"github.com/d2lang/d2/d2format"
	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2layouts/d2talalayout"
	"github.com/d2lang/d2/d2lib"
	"github.com/d2lang/d2/d2oracle"
	"github.com/d2lang/d2/lib/textmeasure"
)

var files = map[string]string{"shared.d2": "a -> x\n"}

func compile(text string) (*d2graph.Graph, error) {
	fs := fstest.MapFS{}
	for p, c := range files {
		fs[p] = &fstest.MapFile{Data: []byte(c)}
	}
	g, _, err := d2compiler.Compile("index.d2", strings.NewReader(text), &d2compiler.CompileOptions{FS: fs})
	return g, err
}

func move(name, text, key, newKey string, desc bool, board []string) {
	fmt.Printf("\n## move %s: %s -> %s (descendants=%v)\n", name, key, newKey, desc)
	g, err := compile(text)
	if err != nil {
		fmt.Println("compile error:", err)
		return
	}
	deltas, derr := d2oracle.MoveIDDeltas(g, key, newKey, desc)
	g2, err := d2oracle.Move(g, board, key, newKey, desc)
	if err != nil {
		fmt.Println("error:", err)
		return
	}
	out := d2format.Format(g2.AST)
	fmt.Printf("deltas: %v %v\n%s", deltas, derr, out)
	if _, err := compile(out); err != nil {
		fmt.Println("recompile error:", err)
	}
}

func main() {
	move("plain", "vpc\na\ndb\na -> db\n", "a", "vpc.a", false, nil)
	move("connection-in-other-container", "vpc\nsvc: { a }\ndb\nsvc.a -> db\nsvc: { a -> b }\n", "svc.a", "vpc.a", false, nil)
	move("with-children", "vpc\nsvc: { a; b; a -> b }\ndb\nsvc.a -> db\n", "svc", "vpc.svc", true, nil)
	move("with-positions", "vpc\na: { top: 40; left: 60 }\n", "a", "vpc.a", false, nil)
	move("scenario-reference", "vpc\na\nscenarios: { s: { a -> b } }\n", "a", "vpc.a", false, nil)
	move("layer-reference", "vpc\na\nlayers: { l: { a -> b } }\n", "a", "vpc.a", false, nil)
	// into-own-descendant (vpc -> vpc.sub.vpc) overflows the Go stack in d2graph AbsID: a fatal error recover cannot catch, so guard before Move.
	move("imported-object", "...@shared\nvpc\n", "a", "vpc.a", false, nil)
	move("name-collision", "vpc: { a }\na\n", "a", "vpc.a", false, nil)
	move("out-to-root", "vpc: { a }\ndb\nvpc.a -> db\n", "vpc.a", "a", false, nil)

	fmt.Println("\n## children and connections per shape")
	for _, s := range []string{"rectangle", "square", "page", "parallelogram", "document", "cylinder", "queue", "package", "step", "callout", "stored_data", "person", "diamond", "oval", "circle", "hexagon", "cloud", "text", "code", "class", "sql_table", "image", "sequence_diagram", "c4-person", "hierarchy"} {
		extra := ""
		if s == "image" {
			extra = "; icon: https://icons.terrastruct.com/aws/Compute/Amazon-EC2.svg"
		}
		_, childErr := compile(fmt.Sprintf("x: { shape: %s%s; c }\n", s, extra))
		_, connErr := compile(fmt.Sprintf("x: { shape: %s%s }\ny\nx -> y\n", s, extra))
		fmt.Printf("%-17s children=%-5v connect=%-5v %v %v\n", s, childErr == nil, connErr == nil, short(childErr), short(connErr))
	}
	for _, t := range []string{"note: |md\n  # Hi\n|\nnote: { c }\n", "snip: |go\n  x := 1\n|\nsnip: { c }\n", "note: |md\n  # Hi\n|\nnote -> y\n"} {
		_, err := compile(t)
		fmt.Printf("block %q -> %v\n", strings.ReplaceAll(t, "\n", "⏎"), short(err))
	}

	fmt.Println("\n## block strings, icons, classes through Set/Create")
	g, _ := compile("vpc\n")
	g, key, err := d2oracle.Create(g, nil, "note")
	fmt.Println("create:", key, err)
	md, tag := "# Title\n- one\n- two", "md"
	g, err = d2oracle.Set(g, nil, key, &tag, &md)
	fmt.Println("set md:", err)
	code, lang := "func main() {}", "go"
	g, _, _ = d2oracle.Create(g, nil, "snippet")
	g, err = d2oracle.Set(g, nil, "snippet", &lang, &code)
	fmt.Println("set code:", err)
	img, icon := "image", "https://icons.terrastruct.com/aws/Compute/Amazon-EC2.svg"
	g, _, _ = d2oracle.Create(g, nil, "ec2")
	// shape: image before icon fails to recompile ("image shape must include an icon field") and returns a nil graph, so icon goes first.
	g, err = d2oracle.Set(g, nil, "ec2.icon", nil, &icon)
	fmt.Println("set icon:", err)
	g, err = d2oracle.Set(g, nil, "ec2.shape", nil, &img)
	fmt.Println("set shape image:", err)
	dash, zone := "3", "zone"
	g, err = d2oracle.Set(g, nil, "classes.zone.style.stroke-dash", nil, &dash)
	fmt.Println("set class def:", err)
	g, err = d2oracle.Set(g, nil, "vpc.class", nil, &zone)
	fmt.Println("set class use:", err)
	g, _, err = d2oracle.Create(g, nil, "a -> b")
	fmt.Println("create connection:", err)
	out := d2format.Format(g.AST)
	fmt.Print(out)
	if g, err = compile(out); err == nil {
		fmt.Println("recompile ok, vpc label/class:", g.Objects[0].ID, g.Objects[0].Classes)
	} else {
		fmt.Println("recompile error:", err)
	}

	fmt.Println("\n## TALA after reparent, pins kept vs cleared")
	for _, text := range []string{
		"vpc: { a: { top: 40; left: 60 }; b }\ndb\nvpc.a -> db\n",
		"vpc: { a; b }\ndb\nvpc.a -> db\n",
		"vpc: { a: { top: 900; left: 900 }; b }\ndb\nvpc.a -> db\n",
		"t: { shape: sql_table; id: int; c }\n",
		"t: { shape: class; f: int; c }\n",
		"t: { shape: text; c }\n",
		"t: |md\n  # Hi\n|\nt: { c }\n",
		"t: { shape: code; c }\n",
	} {
		ruler, _ := textmeasure.NewRuler()
		diagram, g, err := d2lib.Compile(context.Background(), text, &d2lib.CompileOptions{
			Ruler:          ruler,
			LayoutResolver: func(string) (d2graph.LayoutGraph, error) { return func(ctx context.Context, g *d2graph.Graph) error { return d2talalayout.Layout(ctx, g, &d2talalayout.Options{Seeds: []int64{1}}) }, nil },
		}, nil)
		fmt.Printf("%q err=%v\n", text, err)
		if err != nil {
			continue
		}
		_ = diagram
		for _, o := range g.Objects {
			fmt.Printf("  %-6s x=%.0f y=%.0f w=%.0f h=%.0f\n", o.AbsID(), o.TopLeft.X, o.TopLeft.Y, o.Width, o.Height)
		}
	}
}

func short(err error) string {
	if err == nil {
		return ""
	}
	s := err.Error()
	if len(s) > 110 {
		s = s[:110]
	}
	return s
}
