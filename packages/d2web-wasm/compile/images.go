package compile

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"
	"sync"
	"testing/fstest"

	"github.com/d2lang/d2/d2compiler"
	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2renderers/d2scene"
	"github.com/d2lang/d2/lib/imageasset"
)

// Spec 0010: images. The worker never fetches. The page resolves image links (a preflight tells it which) and sends the bytes with the compile
// request; D2's own resolver then reads them through a transport that answers from that map.

// Limits on what the worker accepts, spec 0010 section 2.5. Exceeding one makes that image unresolved; it never fails the board.
const (
	maxImageBytes      = 1 << 22
	maxImageCount      = 256
	maxImageCumulative = 32 << 20
)

// ImageInput is one supplied image: Type is the response content type, Data its bytes (base64 in JSON).
type ImageInput struct {
	Type string `json:"type"`
	Data []byte `json:"data"`
}

// ImageLink is one image a board asks for: Kind is icon, image (a `shape: image`) or edge-icon; Source is D2's own string for the link.
type ImageLink struct {
	Board  string `json:"board"`
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	Source string `json:"source"`
}

// PreflightRequest asks which image links a source contains, without laying anything out.
type PreflightRequest struct {
	V     int               `json:"v"`
	Type  string            `json:"type"`
	ID    int               `json:"id"`
	Files map[string]string `json:"files"`
	Entry string            `json:"entry"`
}

type PreflightResult struct {
	V     int         `json:"v"`
	Type  string      `json:"type"`
	ID    int         `json:"id"`
	Links []ImageLink `json:"links"`
	Error string      `json:"error,omitempty"`
}

// Preflight compiles without layout and lists every image link of every board, after imports, vars, classes and globs are resolved.
// A D2 error is returned as Error with no links: the compile that follows reports the same error.
func Preflight(raw []byte) []byte {
	res := PreflightResult{V: ProtocolVersion, Type: "images", Links: []ImageLink{}}
	var req PreflightRequest
	switch err := json.Unmarshal(raw, &req); {
	case err != nil:
		res.Error = "malformed request: " + err.Error()
	case req.V != ProtocolVersion || req.Type != "preflight":
		res.Error = fmt.Sprintf("unsupported message v=%d type=%q", req.V, req.Type)
	default:
		res.ID = req.ID
		source, ok := req.Files[req.Entry]
		if !ok {
			res.Error = "entry is not among the files"
			break
		}
		fsys := fstest.MapFS{}
		for name, text := range req.Files {
			fsys[name] = &fstest.MapFile{Data: []byte(text)}
		}
		g, _, err := d2compiler.Compile(req.Entry, strings.NewReader(source), &d2compiler.CompileOptions{UTF16Pos: true, FS: fsys})
		if err != nil {
			res.Error = firstLine(err.Error())
			break
		}
		collectLinks(g, "", true, &res.Links)
	}
	out, err := json.Marshal(res)
	if err != nil {
		out, _ = json.Marshal(PreflightResult{V: ProtocolVersion, Type: "images", ID: req.ID, Links: []ImageLink{}, Error: err.Error()})
	}
	return out
}

// collectLinks lists the image links of one board and, when nested is set, of its layers, scenarios and steps. Board paths are the compile
// result's ("" or "/layers/x/scenarios/y").
func collectLinks(g *d2graph.Graph, board string, nested bool, out *[]ImageLink) {
	var here []ImageLink
	for _, o := range g.Objects {
		if o.Icon != nil {
			kind := "icon"
			if o.Shape.Value == "image" {
				kind = "image"
			}
			here = append(here, ImageLink{board, o.AbsID(), kind, o.Icon.String()})
		}
	}
	for _, e := range g.Edges {
		if e.Icon != nil {
			here = append(here, ImageLink{board, e.AbsID(), "edge-icon", e.Icon.String()})
		}
	}
	sort.Slice(here, func(i, j int) bool {
		return here[i].ID+"\x00"+here[i].Kind < here[j].ID+"\x00"+here[j].Kind
	})
	*out = append(*out, here...)
	if !nested {
		return
	}
	for _, group := range []struct {
		name   string
		graphs []*d2graph.Graph
	}{{"layers", g.Layers}, {"scenarios", g.Scenarios}, {"steps", g.Steps}} {
		for _, child := range group.graphs {
			collectLinks(child, board+"/"+group.name+"/"+child.Name, true, out)
		}
	}
}

// requestKey is the form in which a link and the resolver's request for it compare equal: the resolver asks for the URL without its fragment.
func requestKey(link string) string {
	u, err := url.Parse(link)
	if err != nil {
		link, _, _ = strings.Cut(link, "#")
		return link
	}
	u.Fragment, u.RawFragment = "", ""
	return u.String()
}

// imageStore is the resolver's HTTP client: it answers only from the supplied bytes, so the worker makes no network request.
type imageStore struct {
	byKey    map[string]ImageInput
	rejected map[string]string // by key: why a supplied image was not accepted
	localC   *localImages
}

// local is the Cache that answers the resolver for supplied relative paths; one per store, so each is decoded once.
func (s *imageStore) local(limits imageasset.Limits) *localImages {
	if s.localC == nil {
		s.localC = &localImages{store: s, limits: limits}
	}
	return s.localC
}

// newImageStore accepts supplied images in a stable order until a limit is reached; the rest are rejected with a reason.
func newImageStore(supplied map[string]ImageInput) *imageStore {
	s := &imageStore{byKey: map[string]ImageInput{}, rejected: map[string]string{}}
	links := make([]string, 0, len(supplied))
	for link := range supplied {
		links = append(links, link)
	}
	sort.Strings(links)
	total := 0
	for _, link := range links {
		in, key := supplied[link], requestKey(link)
		switch {
		case len(in.Data) == 0:
			s.rejected[key] = "it is empty"
		case len(in.Data) > maxImageBytes:
			s.rejected[key] = fmt.Sprintf("it is larger than %d bytes", maxImageBytes)
		case len(s.byKey) >= maxImageCount:
			s.rejected[key] = fmt.Sprintf("more than %d images were supplied", maxImageCount)
		case total+len(in.Data) > maxImageCumulative:
			s.rejected[key] = fmt.Sprintf("the images supplied exceed %d bytes together", maxImageCumulative)
		default:
			if _, dup := s.byKey[key]; !dup {
				s.byKey[key] = in
				total += len(in.Data)
			}
		}
	}
	return s
}

func (s *imageStore) RoundTrip(req *http.Request) (*http.Response, error) {
	in, ok := s.byKey[requestKey(req.URL.String())]
	if !ok {
		return nil, errors.New("not supplied")
	}
	header := http.Header{}
	if in.Type != "" {
		header.Set("Content-Type", in.Type)
	}
	return &http.Response{StatusCode: 200, Status: "200 OK", Header: header, Body: io.NopCloser(bytes.NewReader(in.Data)), ContentLength: int64(len(in.Data)), Request: req}, nil
}

// unresolvedImages is one warning per link of a board that was not supplied (or was rejected), naming the objects that use it (spec 0010 2.4).
func (s *imageStore) unresolvedImages(board string, g *d2graph.Graph, shownAsLink bool) []Diagnostic {
	var links []ImageLink
	collectLinks(g, board, false, &links)
	type use struct{ ids []string }
	order := []string{}
	uses := map[string]*use{}
	for _, l := range links {
		if strings.HasPrefix(l.Source, "data:") {
			continue
		}
		key := requestKey(l.Source)
		if _, ok := s.byKey[key]; ok {
			continue
		}
		if uses[l.Source] == nil {
			uses[l.Source] = &use{}
			order = append(order, l.Source)
		}
		uses[l.Source].ids = append(uses[l.Source].ids, l.ID)
	}
	var out []Diagnostic
	for _, source := range order {
		why := "it was not supplied"
		if r, ok := s.rejected[requestKey(source)]; ok {
			why = r
		}
		shown := "a placeholder"
		if shownAsLink {
			shown = "a link, not bundled"
		}
		out = append(out, Diagnostic{Severity: "warning", Code: "image-unresolved", Board: board,
			Message: fmt.Sprintf("image %q is shown as %s: %s (used by %s)", source, shown, why, strings.Join(uses[source].ids, ", "))})
	}
	return out
}

// attachLinkedImages adds, to each object whose image link was not supplied, the link and the scene node of its placeholder (spec 0010 2.3).
// A link whose node is not in the scene is left out rather than guessed. store is nil when nothing was supplied (link mode).
func attachLinkedImages(a *Association, doc *d2scene.Document, board string, g *d2graph.Graph, store *imageStore) {
	var links []ImageLink
	collectLinks(g, board, false, &links)
	nodes := map[string]bool{}
	var walk func(*d2scene.Node)
	walk = func(n *d2scene.Node) {
		nodes[n.ID] = true
		for _, c := range n.Children {
			walk(c)
		}
	}
	walk(doc.Root)
	byID := map[string]*AssocObject{}
	for i := range a.Objects {
		byID[a.Objects[i].ID] = &a.Objects[i]
	}
	for _, l := range links {
		if store != nil {
			if _, ok := store.byKey[requestKey(l.Source)]; ok {
				continue
			}
		}
		node := l.ID + ":icon" // the scene builder names a `shape: image` node <id>:image (observed, spec 0010 test 13)
		if l.Kind == "image" {
			node = l.ID + ":image"
		}
		if o := byID[l.ID]; o != nil && nodes[node] {
			o.Image = &AssocImage{Source: l.Source, Role: l.Kind, Node: node}
		}
	}
}

// localImages lets a relative or absolute path be supplied like any link (spec 0010 decision 4). D2's resolver reads such a path from the file system,
// which a browser does not have (and `files` is text only), so it asks its Cache first: this one answers from the supplied bytes. A Resource can only be
// made by D2's own code, so each is produced by resolving the bytes through a private resolver whose transport serves just them. The cache key
// ("file:" + the absolute path) is the resolver's, read from the pinned v0.9.0 source; if it ever changes the path is simply not found and the image is
// unresolved, never wrong.
type localImages struct {
	store  *imageStore
	limits imageasset.Limits
	once   sync.Once
	byKey  map[string]*imageasset.Resource
}

type oneImage ImageInput

func (o oneImage) RoundTrip(req *http.Request) (*http.Response, error) {
	header := http.Header{}
	if o.Type != "" {
		header.Set("Content-Type", o.Type)
	}
	return &http.Response{StatusCode: 200, Status: "200 OK", Header: header, Body: io.NopCloser(bytes.NewReader(o.Data)), ContentLength: int64(len(o.Data)), Request: req}, nil
}

// isLocalPath reports whether the resolver would read this link from the file system: no scheme, not a network-path reference.
func isLocalPath(link string) bool {
	if strings.HasPrefix(link, "//") || strings.HasPrefix(link, "data:") {
		return false
	}
	u, err := url.Parse(link)
	return err == nil && u.Scheme == ""
}

func (l *localImages) load(ctx context.Context) {
	l.once.Do(func() {
		l.byKey = map[string]*imageasset.Resource{}
		for key, in := range l.store.byKey {
			if !isLocalPath(key) {
				continue
			}
			helper, err := imageasset.New(imageasset.Options{BaseDir: "/", HTTPClient: &http.Client{Transport: oneImage(in)}, Limits: l.limits})
			if err != nil {
				continue
			}
			if resource, err := helper.Resolve(ctx, "http://supplied.invalid/"+path.Base(key)); err == nil {
				l.byKey["file:"+path.Clean("/"+key)] = resource
			}
		}
	})
}

func (l *localImages) Get(key string) (*imageasset.Resource, bool) {
	l.load(context.Background())
	if i := strings.Index(key, "file:"); i >= 0 {
		r, ok := l.byKey[key[i:]]
		return r, ok
	}
	return nil, false
}

func (l *localImages) Put(string, *imageasset.Resource) {}
