package compile

import (
	"bytes"
	"reflect"
	"strings"

	"golang.org/x/net/html"

	"github.com/d2lang/d2/d2ast"
	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2renderers/d2scene"
	"github.com/d2lang/d2/d2target"
	"github.com/d2lang/d2/lib/textmeasure"
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

// Property is an effective value and the declaration that owns it: possibly a class, glob or imported file rather than the object's own
// references. Source is nil when D2 reports no declaration.
type Property struct {
	Value  string  `json:"value"`
	Source *Source `json:"source"`
}

type AssocObject struct {
	ID         string              `json:"id"`
	Kind       string              `json:"kind"`
	Parent     string              `json:"parent,omitempty"`
	Label      string              `json:"label"`
	Content    string              `json:"content,omitempty"`
	Nodes      []string            `json:"nodes"`
	References []Source            `json:"references"`
	Properties map[string]Property `json:"properties"`
	Src        string              `json:"src,omitempty"`
	Dst        string              `json:"dst,omitempty"`
	// Spec 0010 2.3: the link of an image the scene could not carry, for the painter to show as a real image element.
	Image *AssocImage `json:"image,omitempty"`
	// HTML is D2's own rendering of a markdown label (textmeasure.RenderMarkdown), the document D2's markdown layout starts from.
	HTML string `json:"html,omitempty"`
	// Box is D2's box for a shape (its position, width and height); for a connection, the exact geometry bounds of its painted paths.
	Box *d2scene.Box `json:"box,omitempty"`
	// Links are the indices into the scene's Links that D2 added for this object.
	Links []int `json:"links,omitempty"`
}

// AssocImage names the image link of an object, the scene node that holds D2's placeholder for it (<id>:icon) and the role D2 gave it.
type AssocImage struct {
	Source string `json:"source"`
	Role   string `json:"role"` // icon, image or edge-icon
	Node   string `json:"node"`
}

type Association struct {
	Objects []AssocObject `json:"objects"`
}

func source(r d2ast.Range) Source {
	pos := func(p d2ast.Position) Pos { return Pos{p.Line, p.Column, p.Byte} }
	return Source{Path: r.Path, Start: pos(r.Start), End: pos(r.End)}
}

func scalar(sc *d2graph.Scalar) Property {
	p := Property{Value: sc.Value}
	if sc.MapKey != nil {
		src := source(sc.MapKey.Range)
		p.Source = &src
	}
	return p
}

// properties lists the label and every style keyword D2 holds a value for, named as in D2's own JSON (fontSize, strokeWidth, 3d, ...).
func properties(label d2graph.Scalar, style d2graph.Style) map[string]Property {
	out := map[string]Property{"label": scalar(&label)}
	v, t := reflect.ValueOf(style), reflect.TypeOf(style)
	for i := 0; i < t.NumField(); i++ {
		if sc, ok := v.Field(i).Interface().(*d2graph.Scalar); ok && sc != nil {
			out[strings.Split(t.Field(i).Tag.Get("json"), ",")[0]] = scalar(sc)
		}
	}
	return out
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

// markdownAttrs are the only attributes D2's markdown layout reads (lib/textmeasure/markdown_svg.go nodeAttr calls).
var markdownAttrs = map[string][]string{"a": {"href", "title"}, "ol": {"start", "type"}, "th": {"align"}, "td": {"align"}}

// markdownElements is D2's own element list (validateMarkdownSVGNodes) less img, which the flow leaves to D2's positioned paint.
var markdownElements = map[string]bool{"p": true, "h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true, "blockquote": true, "ul": true,
	"ol": true, "li": true, "pre": true, "code": true, "em": true, "b": true, "strong": true, "del": true, "s": true, "strike": true, "a": true, "br": true,
	"hr": true, "table": true, "thead": true, "tbody": true, "tfoot": true, "tr": true, "td": true, "th": true}

// markdownHTML is the document D2 lays a markdown label out from (textmeasure.RenderMarkdown, the first step of LayoutMarkdown), parsed as
// D2 parses it and serialised again with only D2's elements and the attributes D2 reads. Raw author HTML is goldmark-unsafe, so anything else
// (an image, an unknown element) returns "" and the object keeps D2's positioned paint.
func markdownHTML(label string) string {
	rendered, err := textmeasure.RenderMarkdown(label)
	if err != nil {
		return ""
	}
	doc, err := html.Parse(strings.NewReader(rendered))
	if err != nil {
		return ""
	}
	var body *html.Node
	var find func(*html.Node)
	find = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "body" {
			body = n
		}
		for c := n.FirstChild; c != nil && body == nil; c = c.NextSibling {
			find(c)
		}
	}
	find(doc)
	ok := body != nil
	var clean func(*html.Node)
	clean = func(n *html.Node) {
		for c := n.FirstChild; c != nil; {
			next := c.NextSibling
			switch c.Type {
			case html.ElementNode:
				if !markdownElements[c.Data] {
					ok = false
				}
				// In markdownAttrs order and once each, so the page finds an anchor's href first (the page applies its link policy to it).
				var kept []html.Attribute
				for _, name := range markdownAttrs[c.Data] {
					for _, a := range c.Attr {
						if a.Namespace == "" && a.Key == name {
							kept = append(kept, html.Attribute{Key: a.Key, Val: a.Val})
							break
						}
					}
				}
				c.Attr = kept
				clean(c)
			case html.TextNode:
			default: // comments and doctypes paint nothing in D2
				n.RemoveChild(c)
			}
			c = next
		}
	}
	if ok {
		clean(body)
	}
	if !ok {
		return ""
	}
	var out bytes.Buffer
	for c := body.FirstChild; c != nil; c = c.NextSibling {
		if err := html.Render(&out, c); err != nil {
			return ""
		}
	}
	return out.String()
}

// linkOwners names the object of every scene link region. D2's scene builder preflight adds one region per shape, then per connection, that
// has a link, tooltip or prettyLink, in diagram order (d2scenebuild compileLinkRegions); markdown inline-link regions follow, each inside the
// viewport of its markdown scene node (`<id>:markdown`, clipped to it), so those go to the smallest such viewport holding them. A count D2's
// order does not explain returns nil rather than shifting every owner.
func linkOwners(d *d2target.Diagram, doc *d2scene.Document, nodeOwner map[string]string) []string {
	var out []string
	for _, s := range d.Shapes {
		if s.Link != "" || s.Tooltip != "" || s.PrettyLink != "" {
			out = append(out, s.ID)
		}
	}
	for _, c := range d.Connections {
		if c.Link != "" || c.Tooltip != "" || c.PrettyLink != "" {
			out = append(out, c.ID)
		}
	}
	if len(out) > len(doc.Links) {
		return nil
	}
	type viewport struct {
		id string
		b  d2scene.Bounds
	}
	var md []viewport
	var walk func(n *d2scene.Node, dx, dy float64)
	walk = func(n *d2scene.Node, dx, dy float64) {
		dx, dy = dx+n.Transform.E, dy+n.Transform.F // scene nodes down to a markdown viewport only translate
		if n.Clip != nil && strings.HasSuffix(n.ID, ":markdown") {
			if b, err := n.Clip.Path.GeometryBounds(); err == nil && b.Valid {
				md = append(md, viewport{nodeOwner[n.ID], b.Translate(d2scene.Point{X: dx, Y: dy})})
			}
		}
		for _, c := range n.Children {
			walk(c, dx, dy)
		}
	}
	walk(doc.Root, 0, 0)
	const eps = .5 // D2 rounds region boxes; a region shares its viewport's edges
	for i := len(out); i < len(doc.Links); i++ {
		r, owner, area := doc.Links[i].Box, "", 0.0
		for _, v := range md {
			w, h := v.b.Max.X-v.b.Min.X, v.b.Max.Y-v.b.Min.Y
			if r.X >= v.b.Min.X-eps && r.Y >= v.b.Min.Y-eps && r.X+r.Width <= v.b.Max.X+eps && r.Y+r.Height <= v.b.Max.Y+eps && (owner == "" || w*h < area) {
				owner, area = v.id, w*h
			}
		}
		out = append(out, owner)
	}
	return out
}

// routeBox is the geometry box of everything a connection's node paints as paths: its route (which D2 splits in two for an animated
// two-way connection) and arrowheads, each through its node transforms. When the diagram has a connection label, D2 puts those paths under a
// masked `<id>:geometry` node. An arrowhead's box is transformed whole, so a diagonal one can widen the box by a few pixels.
func routeBox(n *d2scene.Node) *d2scene.Box {
	if n == nil {
		return nil
	}
	var b d2scene.Bounds
	var add func(nodes []*d2scene.Node, m d2scene.Matrix) bool
	add = func(nodes []*d2scene.Node, m d2scene.Matrix) bool {
		for _, c := range nodes {
			if c.ID == n.ID+":geometry" && !add(c.Children, m.Mul(c.Transform)) {
				return false
			}
			if p, ok := c.Primitive.(d2scene.Path); ok {
				pb, err := p.GeometryBounds()
				if err != nil {
					return false
				}
				b = b.Union(pb.Transform(m.Mul(c.Transform)))
			}
		}
		return true
	}
	if !add(n.Children, n.Transform) || !b.Valid {
		return nil
	}
	return &d2scene.Box{X: b.Min.X, Y: b.Min.Y, Width: b.Max.X - b.Min.X, Height: b.Max.Y - b.Min.Y}
}

func associate(g *d2graph.Graph, d *d2target.Diagram, doc *d2scene.Document) *Association {
	ids := map[string]bool{}
	for _, o := range g.Objects {
		ids[o.AbsID()] = true
	}
	for _, e := range g.Edges {
		ids[e.AbsID()] = true
	}
	nodes := owners(doc, ids)
	top := map[string]*d2scene.Node{}
	for _, n := range doc.Root.Children {
		top[n.ID] = n
	}
	nodeOwner := map[string]string{}
	for id, ns := range nodes {
		for _, n := range ns {
			nodeOwner[n] = id
		}
	}
	shapes := map[string]d2target.Shape{}
	for _, s := range d.Shapes {
		shapes[s.ID] = s
	}
	links := map[string][]int{}
	for i, id := range linkOwners(d, doc, nodeOwner) {
		links[id] = append(links[id], i)
	}
	a := &Association{Objects: []AssocObject{}}
	for _, o := range g.Objects {
		out := AssocObject{ID: o.AbsID(), Kind: "shape", Label: o.Label.Value, Content: content(o), Nodes: nodes[o.AbsID()], References: []Source{}, Properties: properties(o.Label, o.Style)}
		// Only a declared shape: D2 fills in "rectangle" without a key, and a default is absent from properties (spec 0004).
		if o.Shape.MapKey != nil {
			out.Properties["shape"] = scalar(&o.Shape)
		}
		// A locked position (spec 0014), when declared.
		if o.Top != nil {
			out.Properties["top"] = scalar(o.Top)
		}
		if o.Left != nil {
			out.Properties["left"] = scalar(o.Left)
		}
		if out.Nodes == nil {
			out.Nodes = []string{}
		}
		out.Links = links[out.ID]
		if s, ok := shapes[out.ID]; ok {
			out.Box = &d2scene.Box{X: float64(s.Pos.X), Y: float64(s.Pos.Y), Width: float64(s.Width), Height: float64(s.Height)}
		}
		if out.Content == "markdown" {
			out.HTML = markdownHTML(o.Label.Value)
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
		out := AssocObject{ID: e.AbsID(), Kind: "connection", Label: e.Label.Value, Nodes: nodes[e.AbsID()], References: []Source{}, Properties: properties(e.Label, e.Style), Src: e.Src.AbsID(), Dst: e.Dst.AbsID()}
		if out.Nodes == nil {
			out.Nodes = []string{}
		}
		out.Links = links[out.ID]
		out.Box = routeBox(top[out.ID])
		for _, ref := range e.References {
			if ref.Edge != nil {
				out.References = append(out.References, source(ref.Edge.Range))
			}
		}
		a.Objects = append(a.Objects, out)
	}
	return a
}
