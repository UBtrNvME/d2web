package compile

import (
	"strings"

	"github.com/d2lang/d2/d2ast"
	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2renderers/d2scene"
)

// The association payload of spec 0004: D2 objects with their source declarations and the scene nodes that paint them.

type Pos struct {
	Line   int `json:"line"`
	Column int `json:"column"`
	Offset int `json:"offset"`
}

type Source struct {
	Path  string `json:"path"`
	Start Pos    `json:"start"`
	End   Pos    `json:"end"`
}

type AssocObject struct {
	ID         string   `json:"id"`
	Kind       string   `json:"kind"`
	Parent     string   `json:"parent,omitempty"`
	Label      string   `json:"label"`
	Content    string   `json:"content,omitempty"`
	Nodes      []string `json:"nodes"`
	References []Source `json:"references"`
	Src        string   `json:"src,omitempty"`
	Dst        string   `json:"dst,omitempty"`
}

type Association struct {
	Objects []AssocObject `json:"objects"`
}

func source(r d2ast.Range) Source {
	pos := func(p d2ast.Position) Pos { return Pos{p.Line, p.Column, p.Byte} }
	return Source{Path: r.Path, Start: pos(r.Start), End: pos(r.End)}
}

func content(o *d2graph.Object) string {
	switch {
	case o.SQLTable != nil:
		return "sql_table"
	case o.Class != nil:
		return "class"
	case o.Language == "latex":
		return "latex"
	case o.Language == "md" || o.Language == "markdown":
		return "markdown"
	case o.Language != "":
		return "code"
	}
	return ""
}

// owners assigns each scene node to the object whose ID is the node's ID or its longest `<ID>:` prefix (an observed convention of the
// scene builder, see the join probe in research findings; D2 does not document it). Nodes without an owner (root, root:background) are skipped.
func owners(doc *d2scene.Document, ids map[string]bool) map[string][]string {
	out := map[string][]string{}
	var walk func(*d2scene.Node)
	walk = func(n *d2scene.Node) {
		id := n.ID
		for {
			if ids[id] {
				out[id] = append(out[id], n.ID)
				break
			}
			i := strings.LastIndex(id, ":")
			if i < 0 {
				break
			}
			id = id[:i]
		}
		for _, c := range n.Children {
			walk(c)
		}
	}
	walk(doc.Root)
	return out
}

func associate(g *d2graph.Graph, doc *d2scene.Document) *Association {
	ids := map[string]bool{}
	for _, o := range g.Objects {
		ids[o.AbsID()] = true
	}
	for _, e := range g.Edges {
		ids[e.AbsID()] = true
	}
	nodes := owners(doc, ids)
	a := &Association{Objects: []AssocObject{}}
	for _, o := range g.Objects {
		out := AssocObject{ID: o.AbsID(), Kind: "shape", Label: o.Label.Value, Content: content(o), Nodes: nodes[o.AbsID()], References: []Source{}}
		if out.Nodes == nil {
			out.Nodes = []string{}
		}
		if o.Parent != nil && o.Parent.AbsID() != "" {
			out.Parent = o.Parent.AbsID()
		}
		for _, ref := range o.References {
			if ref.Key != nil {
				out.References = append(out.References, source(ref.Key.Range))
			}
		}
		a.Objects = append(a.Objects, out)
	}
	for _, e := range g.Edges {
		out := AssocObject{ID: e.AbsID(), Kind: "connection", Label: e.Label.Value, Nodes: nodes[e.AbsID()], References: []Source{}, Src: e.Src.AbsID(), Dst: e.Dst.AbsID()}
		if out.Nodes == nil {
			out.Nodes = []string{}
		}
		for _, ref := range e.References {
			if ref.Edge != nil {
				out.References = append(out.References, source(ref.Edge.Range))
			}
		}
		a.Objects = append(a.Objects, out)
	}
	return a
}
