// Package edit implements spec 0012: D2 edit operations in, a checked patch to the author's text out, as JSON.
package edit

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing/fstest"
	"time"
	"unicode/utf16"

	"github.com/d2lang/d2/d2ast"
	"github.com/d2lang/d2/d2compiler"
	"github.com/d2lang/d2/d2format"
	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2oracle"
	"github.com/d2lang/d2/d2parser"
)

type Op struct {
	Op         string          `json:"op"` // set | create | delete | rename | move | row | row-delete | row-rename | reorder | reconnect | unset
	Key        string          `json:"key"`
	Value      *string         `json:"value,omitempty"` // set: nil removes the value
	Tag        *string         `json:"tag,omitempty"`
	Name       string          `json:"name,omitempty"`   // rename
	Parent     string          `json:"parent,omitempty"` // move: the new parent's key, "" for the board's root
	To         string          `json:"to,omitempty"`
	Type       *string         `json:"type,omitempty"`
	Constraint json.RawMessage `json:"constraint,omitempty"`
	Before     string          `json:"before,omitempty"`
	Src        string          `json:"src,omitempty"`
	Dst        string          `json:"dst,omitempty"`
	Reverse    bool            `json:"reverse,omitempty"`
}

type Request struct {
	V        int               `json:"v"`
	Type     string            `json:"type"`
	ID       int               `json:"id"`
	Revision int               `json:"revision"`
	Files    map[string]string `json:"files"`
	Entry    string            `json:"entry"`
	Board    string            `json:"board"` // compile result path: "" is the root
	Ops      []Op              `json:"ops"`
}

// Range replaces [Start, End) of the request's entry text, in UTF-16 code units.
type Range struct {
	Start int    `json:"start"`
	End   int    `json:"end"`
	Text  string `json:"text"`
}

type Patch struct {
	File  string  `json:"file"`
	Edits []Range `json:"edits"`
	Text  string  `json:"text"`
}

type IDs struct {
	Created []string          `json:"created"`
	Renamed map[string]string `json:"renamed"`
	Deleted []string          `json:"deleted"`
}

type Error struct {
	Code      string   `json:"code"` // compile | edit | panic | recompile | unchecked | internal
	Message   string   `json:"message"`
	Op        *int     `json:"op,omitempty"`
	Formatted string   `json:"formatted,omitempty"`
	Reason    string   `json:"reason,omitempty"` // unchecked: conflict | inequivalent | label
	Labels    []string `json:"labels,omitempty"` // unchecked, reason label: `id: "before" -> "after"`
}

// Diagnostic has the shape of spec 0001's; `edit-override` marks an edit that wrote a local override for something an imported file declares.
type Diagnostic struct {
	Severity string `json:"severity"`
	Message  string `json:"message"`
	Board    string `json:"board,omitempty"`
	File     string `json:"file,omitempty"`
	Code     string `json:"code"`
}

type Result struct {
	V           int          `json:"v"`
	Type        string       `json:"type"`
	ID          int          `json:"id"`
	Revision    int          `json:"revision"`
	Millis      float64      `json:"millis"`
	Patch       *Patch       `json:"patch,omitempty"`
	IDs         IDs          `json:"ids"`
	Diagnostics []Diagnostic `json:"diagnostics"`
	Error       *Error       `json:"error,omitempty"`
}

// Handle is the JSON entry point used by the worker and the native command.
func Handle(raw []byte, version int) []byte {
	var req Request
	var res Result
	if err := json.Unmarshal(raw, &req); err != nil {
		res = Result{Type: "edited", Diagnostics: []Diagnostic{}, Error: &Error{Code: "internal", Message: "malformed request: " + err.Error()}}
	} else if req.V != version || req.Type != "edit" {
		res = Result{Type: "edited", ID: req.ID, Revision: req.Revision, Diagnostics: []Diagnostic{}, Error: &Error{Code: "internal", Message: fmt.Sprintf("expected an edit request at protocol version %d", version)}}
	} else {
		res = Apply(req)
	}
	res.V = version
	out, _ := json.Marshal(res)
	return out
}

func Apply(req Request) (res Result) {
	start := time.Now()
	res = Result{Type: "edited", ID: req.ID, Revision: req.Revision, IDs: IDs{Created: []string{}, Renamed: map[string]string{}, Deleted: []string{}}, Diagnostics: []Diagnostic{}}
	defer func() { res.Millis = float64(time.Since(start).Microseconds()) / 1000 }()
	text := req.Files[req.Entry]
	g, err := compile(req, text)
	if err != nil {
		res.Error = &Error{Code: "compile", Message: err.Error()}
		return
	}
	formatted := d2format.Format(g.AST)
	before := labels(g, "", map[string]string{})
	board, err := boardPath(req.Board)
	if err != nil {
		res.Error = &Error{Code: "edit", Message: err.Error()}
		return
	}
	warnings := overrides(g, board, req)
	targeted := map[string]bool{}
	if bg := d2oracle.GetBoardGraph(g, board); bg != nil {
		for _, op := range req.Ops {
			if id, _ := target(bg, op.Key); id != "" {
				targeted[req.Board+" "+id] = true
			}
		}
	}
	for i, op := range req.Ops {
		code, err := run(&g, board, req, op, &res.IDs)
		if err != nil {
			res.Error = &Error{Code: code, Message: err.Error(), Op: &i}
			return
		}
	}
	output := d2format.Format(g.AST)
	if _, err := compile(req, output); err != nil {
		res.Error = &Error{Code: "recompile", Message: err.Error()}
		return
	}
	merged, conflicts := merge3(lines(formatted), lines(text), lines(output))
	patched := strings.Join(merged, "\n")
	// Keep the author's final newline; an emptied file stays empty rather than becoming one blank line.
	if patched != "" && (strings.HasSuffix(text, "\n") || text == "") {
		patched += "\n"
	}
	pg, err := compile(req, patched)
	if err != nil || d2format.Format(pg.AST) != output {
		reason := "inequivalent"
		if conflicts > 0 {
			reason = "conflict"
		}
		res.Error = &Error{Code: "unchecked", Message: "no patch to the author's text prints as the edit's result", Formatted: output, Reason: reason}
		return
	}
	if changed := guard(before, pg, req.Ops, targeted); len(changed) > 0 {
		res.Error = &Error{Code: "unchecked", Message: "the patch changes labels the operations did not set", Formatted: output, Reason: "label", Labels: changed}
		return
	}
	res.Patch = &Patch{File: req.Entry, Edits: ranges(text, patched), Text: patched}
	res.Diagnostics = append(res.Diagnostics, warnings...)
	return
}

// overrides warns when an edit targets a board, object or connection that only an imported file declares: d2oracle then writes a local override
// into the entry (`x: {...@x; new}`), the imported file is unchanged. Read from the graph before the operations run, since they mutate it.
func overrides(g *d2graph.Graph, board []string, req Request) []Diagnostic {
	bg := d2oracle.GetBoardGraph(g, board)
	if bg == nil {
		return nil
	}
	warn := func(what, file string) Diagnostic {
		return Diagnostic{Severity: "warning", Code: "edit-override", Board: req.Board, File: file,
			Message: fmt.Sprintf("%s is declared in %s; the edit writes a local override into %s", what, file, req.Entry)}
	}
	sorted := func(files map[string]bool) string {
		var names []string
		for f := range files {
			names = append(names, f)
		}
		sort.Strings(names)
		return strings.Join(names, ", ")
	}
	// An imported board's AST is synthesized in the entry; its objects' references still name the file that declares them.
	if len(board) > 0 {
		files := map[string]bool{}
		for _, o := range bg.Objects {
			for _, r := range o.References {
				files[r.Key.Range.Path] = true
			}
		}
		if len(files) > 0 && !files[req.Entry] {
			return []Diagnostic{warn("board "+req.Board, sorted(files))}
		}
	}
	var out []Diagnostic
	seen := map[string]bool{}
	for _, op := range req.Ops {
		id, files := target(bg, op.Key)
		if id == "" || seen[id] || files[req.Entry] {
			continue
		}
		seen[id] = true
		out = append(out, warn(id, sorted(files)))
	}
	return out
}

// target finds the object or connection a key addresses (the longest ID the key starts with) and the files that declare it.
func target(g *d2graph.Graph, key string) (string, map[string]bool) {
	id, files := "", map[string]bool{}
	owns := func(candidate string) bool {
		return len(candidate) > len(id) && (key == candidate || strings.HasPrefix(key, candidate+"."))
	}
	for _, o := range g.Objects {
		if c := o.AbsID(); owns(c) {
			id, files = c, map[string]bool{}
			for _, r := range o.References {
				files[r.Key.Range.Path] = true
			}
		}
	}
	for _, e := range g.Edges {
		if c := e.AbsID(); owns(c) {
			id, files = c, map[string]bool{}
			for _, r := range e.References {
				files[r.Edge.Range.Path] = true
			}
		}
	}
	return id, files
}

// labels maps every object and connection, on every board, to its label, keyed by board path and ID.
func labels(g *d2graph.Graph, board string, out map[string]string) map[string]string {
	for _, o := range g.Objects {
		out[board+" "+o.AbsID()] = o.Label.Value
	}
	for _, e := range g.Edges {
		out[board+" "+e.AbsID()] = e.Label.Value
	}
	for kind, boards := range map[string][]*d2graph.Graph{"layers": g.Layers, "scenarios": g.Scenarios, "steps": g.Steps} {
		for _, b := range boards {
			labels(b, board+"/"+kind+"/"+b.Name, out)
		}
	}
	return out
}

// guard lists labels of objects present before and after that changed to a value no `set` operation wrote, other than the objects the operations
// address (whose label D2 may derive from the edit: a replaced class, a glob filter). A label set through a shared declaration (a class, a
// glob) changes on every object that uses it, to the value the operation wrote, so that is allowed.
// shortcut: matches by value, not by which declaration owns the label; switch to association sources if an unwritten change ever matches a set value.
func guard(before map[string]string, patched *d2graph.Graph, ops []Op, targeted map[string]bool) []string {
	written := map[string]bool{}
	for _, op := range ops {
		if op.Op == "set" && op.Value != nil {
			written[*op.Value] = true
		}
	}
	var out []string
	for id, after := range labels(patched, "", map[string]string{}) {
		if prev, ok := before[id]; ok && prev != after && !written[after] && !targeted[id] {
			out = append(out, fmt.Sprintf("%s: %q -> %q", strings.TrimPrefix(id, " "), prev, after))
		}
	}
	sort.Strings(out)
	return out
}

func compile(req Request, text string) (*d2graph.Graph, error) {
	fs := fstest.MapFS{}
	for path, contents := range req.Files {
		fs[path] = &fstest.MapFile{Data: []byte(contents)}
	}
	g, _, err := d2compiler.Compile(req.Entry, strings.NewReader(text), &d2compiler.CompileOptions{FS: fs, UTF16Pos: true})
	return g, err
}

// run applies one operation; d2oracle does not guard its own nil dereferences, so a panic becomes an error.
func run(g **d2graph.Graph, board []string, req Request, op Op, ids *IDs) (code string, err error) {
	defer func() {
		if r := recover(); r != nil {
			code, err = "panic", fmt.Errorf("%v", r)
		}
	}()
	var next *d2graph.Graph
	switch op.Op {
	case "set":
		next, err = d2oracle.Set(*g, board, op.Key, op.Tag, op.Value)
	case "create":
		var key string
		if next, key, err = d2oracle.Create(*g, board, op.Key); err == nil {
			ids.Created = append(ids.Created, key)
		}
	case "rename":
		var deltas map[string]string
		if deltas, err = d2oracle.RenameIDDeltas(*g, board, op.Key, op.Name); err == nil {
			if next, _, err = d2oracle.Rename(*g, board, op.Key, op.Name); err == nil {
				ids.follow(deltas)
			}
		}
	case "delete":
		var deltas map[string]string
		if deltas, err = d2oracle.DeleteIDDeltas(*g, board, op.Key); err == nil {
			if next, err = d2oracle.Delete(*g, board, op.Key); err == nil {
				ids.Deleted = append(ids.Deleted, op.Key)
				ids.follow(deltas)
			}
		}
	case "move":
		next, err = move(*g, board, req.Entry, op, ids)
	case "row", "row-delete", "row-rename", "reorder", "reconnect", "unset":
		if len(board) != 0 {
			err = fmt.Errorf("%s only supports the root board", op.Op)
		} else if err = structure(*g, req.Entry, op, ids); err == nil {
			next, err = compile(req, d2format.Format((*g).AST))
		}
	default:
		err = fmt.Errorf("unknown operation %q", op.Op)
	}
	if err != nil {
		return "edit", err
	}
	*g = next
	return "", nil
}

// move reparents an object with its descendants (docs/ideas/palette-primitives.md, findings 1-6). d2oracle.Move overflows the Go stack on a move into
// the object itself or a descendant (not recoverable), writes nothing for an imported object while its deltas claim a move, renames on a name
// collision (`a 2`) and leaves references in inheriting boards (scenarios, steps) behind as new objects; each is refused here instead.
func move(g *d2graph.Graph, board []string, entry string, op Op, ids *IDs) (*d2graph.Graph, error) {
	bg := d2oracle.GetBoardGraph(g, board)
	if bg == nil {
		return nil, fmt.Errorf("board %v not found", board)
	}
	find := func(key string) (*d2graph.Object, error) {
		if key == "" {
			return bg.Root, nil
		}
		mk, err := d2parser.ParseMapKey(key)
		if err != nil || mk.Key == nil || len(mk.Edges) > 0 {
			return nil, fmt.Errorf("%q is not a shape key", key)
		}
		if obj, ok := bg.Root.HasChild(d2graph.Key(mk.Key)); ok {
			return obj, nil
		}
		return nil, fmt.Errorf("%q not found", key)
	}
	obj, err := find(op.Key)
	if err != nil || obj == bg.Root {
		return nil, fmt.Errorf("move needs a shape: %v", err)
	}
	parent, err := find(op.Parent)
	if err != nil {
		return nil, err
	}
	if obj.Parent == parent {
		return g, nil
	}
	for p := parent; p != nil; p = p.Parent {
		if p == obj {
			return nil, fmt.Errorf("cannot move %s into itself", obj.AbsID())
		}
	}
	if file := imported(bg, obj, entry); file != "" {
		return nil, fmt.Errorf("%s or one of its children or connections is declared in the imported file %s; move it there", obj.AbsID(), file)
	}
	if other, ok := parent.HasChild([]string{obj.ID}); ok && other != obj {
		return nil, fmt.Errorf("%s already has a %s", parent.AbsID(), obj.ID)
	}
	old := obj.AbsID()
	key, err := d2oracle.ReparentIDDelta(g, board, op.Key, op.Parent)
	if err != nil {
		return nil, err
	}
	deltas, err := d2oracle.MoveIDDeltas(bg, op.Key, key, true)
	if err != nil {
		return nil, err
	}
	next, err := d2oracle.Move(g, board, op.Key, key, true)
	if err != nil {
		return nil, err
	}
	nb := d2oracle.GetBoardGraph(next, board)
	if name := inherited(nb, old, ""); name != "" {
		return nil, fmt.Errorf("%s is referenced in %s, which inherits this board; moving it would leave a separate %s there", old, name, old)
	}
	// Pins inside the old parent are meaningless in the new one and stretch it (finding 6); TALA places the shape instead.
	if mk, err := d2parser.ParseMapKey(key); err != nil {
		return nil, err
	} else if moved, ok := nb.Root.HasChild(d2graph.Key(mk.Key)); ok {
		for name, pin := range map[string]*d2graph.Scalar{"top": moved.Top, "left": moved.Left} {
			// shortcut: a pin set by a class or glob is not the object's own and stays; delete then fails and is skipped.
			if pin != nil {
				if unpinned, err := d2oracle.Delete(next, board, key+"."+name); err == nil {
					next = unpinned
				}
			}
		}
	}
	ids.follow(deltas)
	return next, nil
}

// imported names a file other than entry that declares obj, a descendant or a connection touching them: d2oracle.Move rewrites only the entry,
// so that declaration would stay behind as a second object.
// shortcut: also refuses an import spread inside obj (`svc: {...@x}`), which Move carries along correctly; tell the spread's site apart if that is needed.
func imported(g *d2graph.Graph, obj *d2graph.Object, entry string) string {
	within := func(o *d2graph.Object) bool {
		for ; o != nil; o = o.Parent {
			if o == obj {
				return true
			}
		}
		return false
	}
	for _, o := range g.Objects {
		if within(o) {
			for _, r := range o.References {
				if r.Key.Range.Path != entry {
					return r.Key.Range.Path
				}
			}
		}
	}
	for _, e := range g.Edges {
		if within(e.Src) || within(e.Dst) {
			for _, r := range e.References {
				if r.Edge.Range.Path != entry {
					return r.Edge.Range.Path
				}
			}
		}
	}
	return ""
}

// inherited names the first scenario or step under g (recursively) that holds id or one of its descendants.
func inherited(g *d2graph.Graph, id, path string) string {
	for kind, boards := range map[string][]*d2graph.Graph{"scenarios": g.Scenarios, "steps": g.Steps} {
		for _, b := range boards {
			name := strings.TrimPrefix(path+"/"+kind+"/"+b.Name, "/")
			for _, o := range b.Objects {
				if o.AbsID() == id || strings.HasPrefix(o.AbsID(), id+".") {
					return name
				}
			}
			if n := inherited(b, id, name); n != "" {
				return n
			}
		}
	}
	return ""
}

// follow records old -> new IDs across the transaction, composing chained renames.
func (ids *IDs) follow(deltas map[string]string) {
	for from, to := range deltas {
		composed := false
		for orig, cur := range ids.Renamed {
			if cur == from {
				ids.Renamed[orig], composed = to, true
			}
		}
		if !composed {
			ids.Renamed[from] = to
		}
	}
}

// boardPath turns a compile result path ("/layers/x/scenarios/y") into d2oracle's, which names boards only (["x", "y"]) and looks each name
// up among layers, then scenarios, then steps.
func boardPath(path string) ([]string, error) {
	if path == "" {
		return nil, nil
	}
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	var names []string
	for i := 0; i < len(parts); i += 2 {
		if i+1 == len(parts) || (parts[i] != "layers" && parts[i] != "scenarios" && parts[i] != "steps") {
			return nil, fmt.Errorf("board path %q is not a compile result path", path)
		}
		names = append(names, parts[i+1])
	}
	return names, nil
}

func lines(s string) []string { return strings.Split(strings.TrimRight(s, "\n"), "\n") }

// ranges turns the line difference between before and after into ascending UTF-16 replacements.
func ranges(before, after string) []Range {
	a, b := strings.SplitAfter(before, "\n"), strings.SplitAfter(after, "\n")
	to := match(a, b)
	offset := make([]int, len(a)+1)
	for i, l := range a {
		offset[i+1] = offset[i] + len(utf16.Encode([]rune(l)))
	}
	out := []Range{}
	i, j := 0, 0
	for i <= len(a) {
		ni, nj := i, j
		for ni < len(a) && to[ni] < 0 {
			ni++
		}
		if ni < len(a) {
			nj = to[ni]
		} else {
			nj = len(b)
		}
		if ni > i || nj > j {
			out = append(out, Range{Start: offset[i], End: offset[ni], Text: strings.Join(b[j:nj], "")})
		}
		i, j = ni+1, nj+1
	}
	return out
}

// astSite keeps the author's node, rather than the IR copy stored in graph references.
type astSite struct {
	parent *d2ast.Map
	key    *d2ast.Key
	part   int
}

func astSites(m *d2ast.Map) []astSite {
	var out []astSite
	for _, n := range m.Nodes {
		if k := n.MapKey; k != nil {
			out = append(out, astSite{parent: m, key: k})
			if k.Value.Map != nil {
				out = append(out, astSites(k.Value.Map)...)
			}
		}
	}
	return out
}
func siteAt(sites []astSite, r d2ast.Range) (astSite, bool) {
	for _, s := range sites {
		if s.key.Range == r {
			return s, true
		}
	}
	return astSite{}, false
}
func (s astSite) remove() {
	for i, n := range s.parent.Nodes {
		if n.MapKey == s.key {
			s.parent.Nodes = append(s.parent.Nodes[:i], s.parent.Nodes[i+1:]...)
			return
		}
	}
}
func shape(g *d2graph.Graph, key string) (*d2graph.Object, error) {
	mk, err := d2parser.ParseMapKey(key)
	if err == nil && mk.Key != nil && len(mk.Edges) == 0 {
		if o, ok := g.Root.HasChild(d2graph.Key(mk.Key)); ok && len(o.AbsIDArray()) == len(mk.Key.Path) {
			return o, nil
		}
	}
	return nil, fmt.Errorf("shape %q not found", key)
}
func connection(g *d2graph.Graph, key string) (*d2graph.Edge, error) {
	mk, err := d2parser.ParseMapKey(key)
	if err == nil && len(mk.Edges) == 1 && mk.EdgeIndex != nil && mk.EdgeIndex.Int != nil && mk.EdgeKey == nil {
		parent := g.Root
		if mk.Key != nil {
			parent, _ = shape(g, d2format.Format(mk.Key))
		}
		if parent != nil {
			if e, ok := parent.HasEdge(mk); ok {
				return e, nil
			}
		}
	}
	return nil, fmt.Errorf("connection %q not found", key)
}
func localShape(g *d2graph.Graph, key, entry string) (*d2graph.Object, error) {
	o, err := shape(g, key)
	if err != nil {
		return nil, err
	}
	if file := imported(g, o, entry); file != "" {
		return nil, fmt.Errorf("%s is declared in imported file %s", key, file)
	}
	for _, r := range o.References {
		if r.IsVar || (r.MapKey != nil && r.MapKey.HasGlob()) {
			return nil, fmt.Errorf("%s has shared glob or variable declarations", key)
		}
		if r.MapKey != nil && (r.MapKey.Value.Import != nil || hasImport(r.MapKey.Value.Map)) {
			return nil, fmt.Errorf("%s contains imported declarations", key)
		}
	}
	return o, nil
}

func hasImport(m *d2ast.Map) bool {
	if m == nil {
		return false
	}
	for _, n := range m.Nodes {
		if n.Import != nil {
			return true
		}
		if k := n.MapKey; k != nil && (k.Value.Import != nil || hasImport(k.Value.Map)) {
			return true
		}
	}
	return false
}

func structure(g *d2graph.Graph, entry string, op Op, ids *IDs) error {
	sites := astSites(g.AST)
	switch op.Op {
	case "row", "row-delete", "row-rename":
		return row(g, sites, entry, op)
	case "reorder":
		return reorder(g, sites, entry, op)
	case "unset":
		return unset(g, sites, entry, op.Key)
	default:
		return reconnect(g, sites, entry, op, ids)
	}
}

// rowSites includes flattened declarations, including a separate name.constraint key.
func rowSites(o *d2graph.Object, sites []astSite) []astSite {
	var out []astSite
	seen := map[*d2ast.Key]bool{}
	add := func(s astSite, part int) {
		if s.key.Key == nil || len(s.key.Edges) > 0 || seen[s.key] {
			return
		}
		name := s.key.Key.Path[part].Unbox()
		if _, reserved := d2ast.ReservedKeywords[strings.ToLower(name.ScalarString())]; reserved && name.IsUnquoted() {
			return
		}
		s.part = part
		seen[s.key] = true
		out = append(out, s)
	}
	for _, s := range sites {
		for _, r := range o.References {
			if r.MapKey == nil || r.InEdge() || r.MapKey.Range != s.key.Range || s.key.Key == nil {
				continue
			}
			part := r.KeyPathIndex + 1
			if part < len(s.key.Key.Path) {
				add(s, part)
			} else if m := s.key.Value.Map; m != nil {
				for _, n := range m.Nodes {
					if n.MapKey != nil && n.MapKey.Key != nil {
						add(astSite{parent: m, key: n.MapKey}, 0)
					}
				}
			}
		}
	}
	return out
}
func namedRows(sites []astSite, name string) []astSite {
	var out []astSite
	for _, s := range sites {
		if strings.EqualFold(s.key.Key.Path[s.part].Unbox().ScalarString(), name) {
			out = append(out, s)
		}
	}
	return out
}
func rowName(name string) *d2ast.StringBox {
	if _, reserved := d2ast.ReservedKeywords[strings.ToLower(name)]; reserved || name == "_" {
		return d2ast.MakeValueBox(d2ast.FlatDoubleQuotedString(name)).StringBox()
	}
	return d2ast.RawStringBox(name, true)
}
func constraint(raw json.RawMessage) (d2ast.ValueBox, error) {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return d2ast.ValueBox{}, err
	}
	switch v := v.(type) {
	case nil:
		return d2ast.ValueBox{}, nil
	case string:
		return d2ast.MakeValueBox(d2ast.RawString(v, false)), nil
	case []any:
		a := &d2ast.Array{}
		for _, item := range v {
			s, ok := item.(string)
			if !ok {
				return d2ast.ValueBox{}, fmt.Errorf("constraint must contain strings")
			}
			a.Nodes = append(a.Nodes, d2ast.MakeArrayNodeBox(d2ast.RawString(s, false)))
		}
		return d2ast.MakeValueBox(a), nil
	default:
		return d2ast.ValueBox{}, fmt.Errorf("constraint must be null, a string or a string list")
	}
}
func row(g *d2graph.Graph, sites []astSite, entry string, op Op) error {
	o, err := localShape(g, op.Key, entry)
	if err != nil {
		return err
	}
	if o.SQLTable == nil && o.Class == nil {
		return fmt.Errorf("%s is not a sql_table or class", op.Key)
	}
	if op.Name == "" || (op.Op == "row-rename" && op.To == "") {
		return fmt.Errorf("row names must not be empty")
	}
	if o.Class != nil && len(op.Constraint) > 0 {
		return fmt.Errorf("class rows do not have constraints")
	}
	all := rowSites(o, sites)
	rows := namedRows(all, op.Name)
	if op.Op != "row" && len(rows) == 0 {
		return fmt.Errorf("row %q not found", op.Name)
	}
	switch op.Op {
	case "row-delete":
		for _, s := range rows {
			s.remove()
		}
		return nil
	case "row-rename":
		if len(namedRows(all, op.To)) > 0 && !strings.EqualFold(op.Name, op.To) {
			return fmt.Errorf("row %q already exists", op.To)
		}
		for _, e := range g.Edges {
			for _, end := range []struct {
				o     *d2graph.Object
				index *int
			}{{e.Src, e.SrcTableColumnIndex}, {e.Dst, e.DstTableColumnIndex}} {
				if end.o == o && end.index != nil && strings.EqualFold(o.SQLTable.Columns[*end.index].Name.Label, op.Name) {
					return fmt.Errorf("a connection references row %q", op.Name)
				}
			}
		}
		for _, s := range rows {
			s.key.Key.Path[s.part] = rowName(op.To)
		}
		return nil
	}
	return upsertRow(g, o, rows, op)
}

func upsertRow(g *d2graph.Graph, o *d2graph.Object, rows []astSite, op Op) error {
	var err error
	var value d2ast.ValueBox
	if len(op.Constraint) > 0 {
		value, err = constraint(op.Constraint)
		if err != nil {
			return err
		}
	}
	base, constraints := rowValues(rows, op.Type)
	if base == nil && (len(rows) == 0 || op.Type != nil) {
		base = appendRow(g, o, rows, op)
	}
	if len(op.Constraint) == 0 {
		return nil
	}
	if len(constraints) > 0 {
		for _, s := range constraints {
			if value.Unbox() == nil {
				s.remove()
			} else {
				s.key.Value = value
			}
		}
	} else if value.Unbox() != nil {
		if base == nil {
			return fmt.Errorf("row %q has no writable type declaration", op.Name)
		}
		k := base.key
		if k.Value.Map == nil {
			k.Primary = k.Value.ScalarBox()
			k.Value = d2ast.MakeValueBox(inlineMap())
		}
		k.Value.Map.Nodes = append(k.Value.Map.Nodes, d2ast.MakeMapNodeBox(&d2ast.Key{Key: d2ast.MakeKeyPath([]string{"constraint"}), Value: value}))
	}
	return nil
}

func rowValues(rows []astSite, typ *string) (*astSite, []astSite) {
	var base *astSite
	var constraints []astSite
	for _, s := range rows {
		tail := s.key.Key.Path[s.part+1:]
		if len(tail) == 0 {
			if base == nil {
				copy := s
				base = &copy
			}
			if typ != nil {
				v := d2ast.RawString(*typ, false)
				if s.key.Value.Map != nil {
					s.key.Primary = d2ast.MakeValueBox(v).ScalarBox()
				} else {
					s.key.Value = d2ast.MakeValueBox(v)
				}
			}
			if m := s.key.Value.Map; m != nil {
				for _, n := range m.Nodes {
					if k := n.MapKey; k != nil && k.Key != nil && len(k.Key.Path) == 1 && k.Key.Path[0].Unbox().ScalarString() == "constraint" {
						constraints = append(constraints, astSite{parent: m, key: k})
					}
				}
			}
		} else if len(tail) == 1 && tail[0].Unbox().ScalarString() == "constraint" {
			constraints = append(constraints, s)
		}
	}
	return base, constraints
}

func appendRow(g *d2graph.Graph, o *d2graph.Object, rows []astSite, op Op) *astSite {
	k := &d2ast.Key{Key: d2ast.MakeKeyPath([]string{op.Name})}
	k.Key.Path[0] = rowName(op.Name)
	var m *d2ast.Map
	sites := astSites(g.AST)
	for _, r := range o.References {
		if r.MapKey != nil && !r.InEdge() && r.KeyPathIndex == len(r.Key.Path)-1 {
			if s, ok := siteAt(sites, r.MapKey.Range); ok && s.key.Value.Map != nil {
				m = s.key.Value.Map
			}
		}
	}
	if len(rows) > 0 {
		s := rows[0]
		m = s.parent
		k.Key.Path = append(append([]*d2ast.StringBox{}, s.key.Key.Path[:s.part]...), rowName(op.Name))
	}
	if m == nil {
		mk, _ := d2parser.ParseMapKey(o.AbsID())
		m = inlineMap()
		g.AST.Nodes = append(g.AST.Nodes, d2ast.MakeMapNodeBox(&d2ast.Key{Key: mk.Key, Value: d2ast.MakeValueBox(m)}))
	}
	if op.Type != nil {
		k.Value = d2ast.MakeValueBox(d2ast.RawString(*op.Type, false))
	}
	m.Nodes = append(m.Nodes, d2ast.MakeMapNodeBox(k))
	return &astSite{parent: m, key: k}
}

func declaration(g *d2graph.Graph, sites []astSite, entry, key string) (astSite, string, string, error) {
	if o, err := shape(g, key); err == nil {
		if _, err = localShape(g, key, entry); err != nil {
			return astSite{}, "", "", err
		}
		for _, s := range sites {
			for _, r := range o.References {
				if r.MapKey != nil && !r.InEdge() && r.KeyPathIndex == len(r.Key.Path)-1 && r.MapKey.Range == s.key.Range {
					return s, "shape", o.Parent.AbsID(), nil
				}
			}
		}
	} else if e, err := connection(g, key); err == nil {
		for _, r := range e.References {
			if r.MapKey.Range.Path != entry {
				return astSite{}, "", "", fmt.Errorf("imported connection")
			}
		}
		for _, s := range sites {
			for _, r := range e.References {
				if r.MapKey.Range == s.key.Range && s.key.EdgeIndex == nil {
					if len(s.key.Edges) != 1 {
						return astSite{}, "", "", fmt.Errorf("cannot reorder part of a connection chain")
					}
					return s, "connection", r.ScopeObj.AbsID(), nil
				}
			}
		}
	} else {
		mk, err := d2parser.ParseMapKey(key)
		if err == nil && mk.Key != nil && len(mk.Edges) == 0 && len(mk.Key.Path) > 1 {
			path := mk.Key.Path
			mk.Key.Path = path[:len(path)-1]
			if o, err := localShape(g, d2format.Format(mk.Key), entry); err == nil && (o.SQLTable != nil || o.Class != nil) {
				rows := namedRows(rowSites(o, sites), path[len(path)-1].Unbox().ScalarString())
				if len(rows) > 0 {
					return rows[0], "row", o.AbsID(), nil
				}
			}
		}
	}
	return astSite{}, "", "", fmt.Errorf("no writable declaration for %q", key)
}
func reorder(g *d2graph.Graph, sites []astSite, entry string, op Op) error {
	s, kind, parent, err := declaration(g, sites, entry, op.Key)
	if err != nil {
		return err
	}
	var before *d2ast.Key
	if op.Before != "" {
		b, bkind, bparent, err := declaration(g, sites, entry, op.Before)
		if err != nil {
			return err
		}
		if bkind != kind || bparent != parent || b.parent != s.parent {
			return fmt.Errorf("reorder needs the same kind and parent map")
		}
		before = b.key
		if before == s.key {
			return nil
		}
	}
	s.remove()
	s.parent.InsertBefore(before, s.key)
	return nil
}

func relativeEnd(scope, end *d2graph.Object) *d2ast.KeyPath {
	var names []string
	for p := end; p.Parent != nil; p = p.Parent {
		names = append([]string{p.IDVal}, names...)
	}
	var parents []string
	for p := scope; p != nil && p.Parent != nil; p = p.Parent {
		parents = append([]string{p.IDVal}, parents...)
	}
	i := 0
	for i < len(names) && i < len(parents) && strings.EqualFold(names[i], parents[i]) {
		i++
	}
	path := make([]string, len(parents)-i)
	for j := range path {
		path[j] = "_"
	}
	return d2ast.MakeKeyPath(append(path, names[i:]...))
}
func reconnect(g *d2graph.Graph, sites []astSite, entry string, op Op, ids *IDs) error {
	e, err := connection(g, op.Key)
	if err != nil {
		return err
	}
	next := *e
	if op.Src != "" {
		next.Src, err = shape(g, op.Src)
		if err != nil {
			return err
		}
		next.SrcTableColumnIndex = nil
	}
	if op.Dst != "" {
		next.Dst, err = shape(g, op.Dst)
		if err != nil {
			return err
		}
		next.DstTableColumnIndex = nil
	}
	if op.Reverse {
		next.Src, next.Dst = next.Dst, next.Src
		// The arrowheads stay where they are, so the arrow now points the other way (`a -> b` becomes `b -> a`).
		next.SrcTableColumnIndex, next.DstTableColumnIndex = next.DstTableColumnIndex, next.SrcTableColumnIndex
	}
	// shortcut: a chain shares endpoints between edges; refuse it until splitting preserves every edge's attributes.
	for _, r := range e.References {
		if r.MapKey.Range.Path != entry {
			return fmt.Errorf("imported connection")
		}
		if r.MapKey.HasGlob() {
			return fmt.Errorf("connection has a shared glob declaration")
		}
		if len(r.MapKey.Edges) != 1 {
			return fmt.Errorf("cannot reconnect part of a connection chain")
		}
		if _, ok := siteAt(sites, r.MapKey.Range); !ok {
			return fmt.Errorf("connection has no writable declaration")
		}
	}
	// Renumber the affected parallel groups in declaration order, including their indexed property references.
	counts := map[string]int{}
	deltas := map[string]string{}
	for _, old := range g.Edges {
		changed := *old
		if old == e {
			changed = next
		}
		changed.Index = 0
		group := changed.AbsID()
		changed.Index = counts[group]
		counts[group]++
		if old.AbsID() != changed.AbsID() {
			deltas[old.AbsID()] = changed.AbsID()
		}
		if old != e && old.Index == changed.Index {
			continue
		}
		seen := map[*d2ast.Key]bool{}
		for _, r := range old.References {
			if r.MapKey.Range.Path != entry {
				return fmt.Errorf("parallel connection is imported")
			}
			s, ok := siteAt(sites, r.MapKey.Range)
			if !ok {
				return fmt.Errorf("connection has no writable declaration")
			}
			if seen[s.key] {
				continue
			}
			seen[s.key] = true
			if old == e {
				if len(s.key.Edges) != 1 {
					return fmt.Errorf("cannot reconnect part of a connection chain")
				}
				scope := r.ScopeObj
				edge := s.key.Edges[0]
				edge.Src, edge.Dst = relativeEnd(scope, changed.Src), relativeEnd(scope, changed.Dst)
				if changed.SrcTableColumnIndex != nil {
					edge.Src.Path = append(edge.Src.Path, d2ast.RawStringBox(changed.Src.SQLTable.Columns[*changed.SrcTableColumnIndex].Name.Label, true))
				}
				if changed.DstTableColumnIndex != nil {
					edge.Dst.Path = append(edge.Dst.Path, d2ast.RawStringBox(changed.Dst.SQLTable.Columns[*changed.DstTableColumnIndex].Name.Label, true))
				}
				edge.SrcArrow, edge.DstArrow = "", ""
				if changed.SrcArrow {
					edge.SrcArrow = "<"
				}
				if changed.DstArrow {
					edge.DstArrow = ">"
				}
			}
			if s.key.EdgeIndex != nil {
				index := changed.Index
				s.key.EdgeIndex.Int = &index
			}
		}
	}
	// Compose once: parallel renumbering can reuse another connection's old ID.
	composed := map[string]bool{}
	for orig, cur := range ids.Renamed {
		if to, ok := deltas[cur]; ok {
			ids.Renamed[orig] = to
			composed[cur] = true
		}
	}
	for from, to := range deltas {
		if !composed[from] {
			ids.Renamed[from] = to
		}
	}
	return nil
}

func inlineMap() *d2ast.Map {
	return &d2ast.Map{Range: d2ast.Range{Start: d2ast.Position{Column: 1}}}
}

func keywordSites(s astSite, offset int, path []*d2ast.StringBox) []astSite {
	if s.key.Key == nil {
		return nil
	}
	parts := s.key.Key.Path[offset:]
	for i := 0; i < len(parts) && i < len(path); i++ {
		if !parts[i].Unbox().IsUnquoted() || !strings.EqualFold(parts[i].Unbox().ScalarString(), path[i].Unbox().ScalarString()) {
			return nil
		}
	}
	if len(parts) >= len(path) {
		return []astSite{s}
	}
	var out []astSite
	if m := s.key.Value.Map; m != nil {
		for _, n := range m.Nodes {
			if n.MapKey != nil {
				out = append(out, keywordSites(astSite{parent: m, key: n.MapKey}, 0, path[len(parts):])...)
			}
		}
	}
	return out
}

func pruneEmptyMaps(sites, removed []astSite, root *d2ast.Map, gone map[*d2ast.Key]bool) {
	for _, s := range removed {
		m := s.parent
		for len(m.Nodes) == 0 && m != root {
			var owner *astSite
			for _, candidate := range sites {
				if candidate.key.Value.Map == m {
					copy := candidate
					owner = &copy
					break
				}
			}
			if owner == nil {
				break
			}
			owner.key.Value = d2ast.ValueBox{}
			if owner.key.Primary.Unbox() != nil {
				owner.key.Value = d2ast.MakeValueBox(owner.key.Primary.Unbox())
				owner.key.Primary = d2ast.ScalarBox{}
			} else if path := owner.key.Key; path != nil {
				last := path.Path[len(path.Path)-1].Unbox()
				if _, reserved := d2ast.ReservedKeywords[strings.ToLower(last.ScalarString())]; reserved && last.IsUnquoted() {
					owner.remove()
					gone[owner.key] = true
				}
			}
			m = owner.parent
		}
	}
}

func unset(g *d2graph.Graph, sites []astSite, entry, key string) error {
	mk, err := d2parser.ParseMapKey(key)
	if err != nil || mk.Key == nil || len(mk.Edges) > 0 || len(mk.Key.Path) < 2 {
		return fmt.Errorf("unset needs an object's reserved keyword")
	}
	path := mk.Key.Path
	var o *d2graph.Object
	var cut int
	for cut = len(path) - 1; cut > 0; cut-- {
		mk.Key.Path = path[:cut]
		if o, err = shape(g, d2format.Format(mk.Key)); err == nil {
			break
		}
	}
	if o == nil {
		return fmt.Errorf("unset needs an existing object")
	}
	for _, part := range path[cut:] {
		name := strings.ToLower(part.Unbox().ScalarString())
		if _, ok := d2ast.ReservedKeywords[name]; !ok || !part.Unbox().IsUnquoted() || name == "style" {
			return fmt.Errorf("unset only supports reserved keywords outside style")
		}
	}
	if _, err = localShape(g, o.AbsID(), entry); err != nil {
		return err
	}
	var removed []astSite
	gone := map[*d2ast.Key]bool{}
	for _, r := range o.References {
		if r.MapKey == nil || r.InEdge() {
			continue
		}
		if s, ok := siteAt(sites, r.MapKey.Range); ok {
			for _, site := range keywordSites(s, r.KeyPathIndex+1, path[cut:]) {
				if !gone[site.key] {
					removed = append(removed, site)
					gone[site.key] = true
				}
			}
		}
	}
	if len(removed) == 0 {
		return fmt.Errorf("keyword %q has no local declaration", key)
	}
	for _, s := range removed {
		s.remove()
	}
	pruneEmptyMaps(sites, removed, g.AST, gone)
	for _, r := range o.References {
		if s, ok := siteAt(sites, r.MapKey.Range); ok && !gone[s.key] {
			return nil
		}
	}
	// A flattened keyword can be the object's only declaration; keep the object when removing it.
	g.AST.Nodes = append(g.AST.Nodes, d2ast.MakeMapNodeBox(&d2ast.Key{Key: mk.Key}))
	return nil
}
