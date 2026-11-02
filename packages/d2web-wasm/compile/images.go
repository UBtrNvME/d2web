package compile

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"testing/fstest"

	"github.com/d2lang/d2/d2compiler"
	"github.com/d2lang/d2/d2graph"
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
func (s *imageStore) unresolvedImages(board string, g *d2graph.Graph) []Diagnostic {
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
		out = append(out, Diagnostic{Severity: "warning", Code: "image-unresolved", Board: board,
			Message: fmt.Sprintf("image %q is shown as a placeholder: %s (used by %s)", source, why, strings.Join(uses[source].ids, ", "))})
	}
	return out
}
