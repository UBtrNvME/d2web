package compile

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
	"unicode/utf16"
)

func TestMarkdownHTMLKeepsD2ElementsAndOnlyTheAttributesD2Reads(t *testing.T) {
	for source, want := range map[string]string{
		"# T\n\n- a\n  - b\n\n3. c\n\n| x | y |\n|:-:|--:|\n| 1 | 2 |":                                      "<h1>T</h1>\n<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul>\n</li>\n</ul>\n<ol start=\"3\">\n<li>c</li>\n</ol>\n<table>\n<thead>\n<tr>\n<th align=\"center\">x</th>\n<th align=\"right\">y</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td align=\"center\">1</td>\n<td align=\"right\">2</td>\n</tr>\n</tbody>\n</table>\n",
		`<p onclick="x()" style="color:red">hi <!-- c --></p> <a href="javascript:x" onmouseover="y">j</a>`: `<p>hi </p> <a href="javascript:x">j</a>`,
		`[l](https://x.test "t")`: `<p><a href="https://x.test" title="t">l</a></p>` + "\n",
		"```\n<&>\n```":           "<pre><code>&lt;&amp;&gt;\n</code></pre>\n",
		"![i](x.png)":             "",
		"<span>x</span>":          "",
		`<a title="t" href="https://y.test" href="javascript:x">y</a>`: `<p><a href="https://y.test" title="t">y</a></p>` + "\n",
	} {
		if got := markdownHTML(source); got != want {
			t.Errorf("%q:\n got %q\nwant %q", source, got, want)
		}
	}
}

// Owners come from D2's preflight order (shapes, then connections, with metadata) and markdown viewports, not from geometry guesses.
func TestLinkRegionsNameTheirObjects(t *testing.T) {
	source := "big: { link: https://big.test\n  small: { tooltip: inner } }\nplain\nplain -> big: go { link: https://edge.test }\nmd: |md\n  [x](https://md.test)\n|\nout: |md\n  [o](https://out.test)\n| { label.near: outside-top-center; style.shadow: true }\nplain -> md: |md\n  [e](https://edge-md.test)\n|\n"
	res := compileText(t, source)
	if res["error"] != nil {
		t.Fatal(res["error"])
	}
	board := res["boards"].([]any)[0].(map[string]any)
	regions := board["scene"].(map[string]any)["Links"].([]any)
	owner := map[string]string{}
	for _, o := range board["association"].(map[string]any)["objects"].([]any) {
		obj := o.(map[string]any)
		links, _ := obj["links"].([]any)
		for _, i := range links {
			r := regions[int(i.(float64))].(map[string]any)
			owner[fmt.Sprint(r["URL"], r["Tooltip"])] = obj["id"].(string)
		}
	}
	want := map[string]string{"https://big.test": "big", "inner": "big.small", "https://edge.test": "(plain -> big)[0]", "https://md.test": "md", "https://out.test": "out", "https://edge-md.test": "(plain -> md)[0]"}
	if len(owner) != len(regions) || len(owner) != len(want) {
		t.Fatalf("owners %v for %d regions", owner, len(regions))
	}
	for k, id := range want {
		if owner[k] != id {
			t.Errorf("%s owned by %q, want %q", k, owner[k], id)
		}
	}
}

// A shape's box is D2's own box, whatever paints it: curves, a `multiple` back card or a shadow group do not move it.
func TestShapeBoxIsD2sBox(t *testing.T) {
	res := compileText(t, "c: { shape: cylinder; width: 100; height: 80 }\nq: { shape: cloud; width: 120; height: 70 }\nm: { style.multiple: true; width: 90; height: 60 }\nk: { shape: cylinder; style.multiple: true; width: 70; height: 110 }\ns: { style.shadow: true; width: 50; height: 40 }\nc -> q\n")
	got := map[string][2]float64{}
	for _, o := range res["boards"].([]any)[0].(map[string]any)["association"].(map[string]any)["objects"].([]any) {
		obj := o.(map[string]any)
		if b, ok := obj["box"].(map[string]any); ok {
			got[obj["id"].(string)] = [2]float64{b["Width"].(float64), b["Height"].(float64)}
		}
	}
	for id, want := range map[string][2]float64{"c": {100, 80}, "q": {120, 70}, "m": {90, 60}, "k": {70, 110}, "s": {50, 40}} {
		if got[id] != want {
			t.Errorf("%s box %v, want %v", id, got[id], want)
		}
	}
	if r := got["(c -> q)[0]"]; r[1] <= 0 {
		t.Errorf("connection route box %v", r)
	}
	// An animated two-way route is painted as two paths; the box covers both, so it matches the plain route's.
	boxOf := func(source string) [2]float64 {
		for _, o := range compileText(t, source)["boards"].([]any)[0].(map[string]any)["association"].(map[string]any)["objects"].([]any) {
			if obj := o.(map[string]any); obj["id"] == "(a <-> b)[0]" {
				b := obj["box"].(map[string]any)
				return [2]float64{b["Width"].(float64), b["Height"].(float64)}
			}
		}
		return [2]float64{}
	}
	if plain, animated := boxOf("a <-> b\n"), boxOf("a <-> b: { style.animated: true }\n"); plain != animated || plain[1] == 0 {
		t.Errorf("animated route box %v, plain %v", animated, plain)
	}
	// The box spans the gap between the two shapes (D2 ends a route a pixel or two short), with arrowheads in place, not at their local
	// origin; also when a connection label makes D2 put every route under a masked `:geometry` node.
	boxes := map[string]map[string]any{}
	for _, o := range compileText(t, "a -> b\nc -> d: label\n")["boards"].([]any)[0].(map[string]any)["association"].(map[string]any)["objects"].([]any) {
		obj := o.(map[string]any)
		boxes[obj["id"].(string)], _ = obj["box"].(map[string]any)
	}
	near := func(a, b float64) bool { return a-b < 2 && b-a < 2 }
	for _, e := range [][3]string{{"(a -> b)[0]", "a", "b"}, {"(c -> d)[0]", "c", "d"}} {
		r, src, dst := boxes[e[0]], boxes[e[1]], boxes[e[2]]
		if r == nil || !near(r["Y"].(float64), src["Y"].(float64)+src["Height"].(float64)) || !near(r["Y"].(float64)+r["Height"].(float64), dst["Y"].(float64)) {
			t.Errorf("masked route box %v between %v and %v", r, src, dst)
		}
	}
}

// Spec 0004 amendment (2 November 2026, for the d2editor inspector): a declared shape and its declaration; D2's default rectangle is absent.
// Spec 0014: the editor reads the written top/left to move a shape exactly.
func TestTopLeftPropertyAndSource(t *testing.T) {
	res := compileText(t, "a: {\n  top: 100\n  left: 200\n}\nb\n")
	props := map[string]map[string]any{}
	for _, o := range res["boards"].([]any)[0].(map[string]any)["association"].(map[string]any)["objects"].([]any) {
		obj := o.(map[string]any)
		props[obj["id"].(string)] = obj["properties"].(map[string]any)
	}
	for name, want := range map[string]struct {
		value string
		line  float64
	}{"top": {"100", 1}, "left": {"200", 2}} {
		p, ok := props["a"][name].(map[string]any)
		if !ok || p["value"] != want.value || p["source"].(map[string]any)["start"].(map[string]any)["line"] != want.line {
			t.Errorf("a %s %v, want %s declared on line %v", name, props["a"][name], want.value, want.line)
		}
	}
	for _, name := range []string{"top", "left"} {
		if _, ok := props["b"][name]; ok {
			t.Errorf("b has no %s, got %v", name, props["b"][name])
		}
	}
}

func TestShapePropertyAndSource(t *testing.T) {
	res := compileText(t, "classes: {db: {shape: cylinder}}\na: {shape: person}\nb.class: db\nc\n")
	props := map[string]map[string]any{}
	for _, o := range res["boards"].([]any)[0].(map[string]any)["association"].(map[string]any)["objects"].([]any) {
		obj := o.(map[string]any)
		props[obj["id"].(string)] = obj["properties"].(map[string]any)
	}
	for id, want := range map[string]struct {
		value string
		line  float64
	}{"a": {"person", 1}, "b": {"cylinder", 0}} {
		shape, ok := props[id]["shape"].(map[string]any)
		if !ok || shape["value"] != want.value || shape["source"].(map[string]any)["start"].(map[string]any)["line"] != want.line {
			t.Errorf("%s shape %v, want %s declared on line %v", id, props[id]["shape"], want.value, want.line)
		}
	}
	if _, ok := props["c"]["shape"]; ok {
		t.Errorf("c has no declared shape, got %v", props["c"]["shape"])
	}
}

func TestClassesPerBoardAndCodeLanguage(t *testing.T) {
	var req map[string]any
	_ = json.Unmarshal(request(""), &req)
	req["files"] = map[string]string{
		"main.d2":   "...@shared\nclasses: {zone: {style.stroke-dash: 3}}\nsnip: |python print(1) |\nnote: |md # hi |\nvpc.class: [zone; shared]\nscenarios: {s: {classes: {extra: {style.fill: red}}}}\nlayers: {l: {x; classes: {mine: {style.fill: blue}}}}\n",
		"shared.d2": "classes: {shared: {shape: cylinder}}\n",
	}
	req["boards"] = []string{"", "/scenarios/s", "/layers/l"}
	raw, _ := json.Marshal(req)
	var res map[string]any
	if err := json.Unmarshal(Handle(context.Background(), raw), &res); err != nil || res["error"] != nil {
		t.Fatal(err, res["error"])
	}
	got := map[string]string{}
	languages, applied := map[string]any{}, map[string]any{}
	for _, b := range res["boards"].([]any) {
		board := b.(map[string]any)
		assoc := board["association"].(map[string]any)
		got[board["path"].(string)] = fmt.Sprint(assoc["classes"])
		if board["path"] == "" {
			for _, o := range assoc["objects"].([]any) {
				obj := o.(map[string]any)
				languages[obj["id"].(string)] = obj["language"]
				applied[obj["id"].(string)] = obj["classes"]
			}
		}
	}
	// Imports count; scenarios and layers both carry the root's classes in D2 v0.9.0 (the IR copies them).
	want := map[string]string{"": "[shared zone]", "/scenarios/s": "[extra shared zone]", "/layers/l": "[mine shared zone]"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("classes %v, want %v", got, want)
	}
	if fmt.Sprint(applied["vpc"]) != "[zone shared]" || applied["note"] != nil {
		t.Errorf("applied classes %v", applied)
	}
	if languages["snip"] != "python" || languages["note"] != nil {
		t.Errorf("languages %v", languages)
	}
}

func TestAssociationRows(t *testing.T) {
	res := compileText(t, `t: {shape: sql_table; id: int {constraint: [primary_key; unique]}; name: varchar}
c: {shape: class; "+run(x int)": bool; -name: string; plain; "#save()": int}
plain
`)
	if res["error"] != nil {
		t.Fatal(res["error"])
	}
	got := map[string]any{}
	for _, o := range res["boards"].([]any)[0].(map[string]any)["association"].(map[string]any)["objects"].([]any) {
		obj := o.(map[string]any)
		got[obj["id"].(string)] = obj["rows"]
	}
	want := map[string]any{
		"t":     []any{map[string]any{"name": "id", "type": "int", "constraint": []any{"primary_key", "unique"}}, map[string]any{"name": "name", "type": "varchar"}},
		"c":     []any{map[string]any{"name": "+run(x int)", "type": "bool"}, map[string]any{"name": "-name", "type": "string"}, map[string]any{"name": "plain", "type": ""}, map[string]any{"name": "#save()", "type": "int"}},
		"plain": nil,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestClassRowsFromImportsAndBoards(t *testing.T) {
	var req map[string]any
	_ = json.Unmarshal(request(""), &req)
	req["files"] = map[string]string{"main.d2": "...@shared\nscenarios: {s: {c.+extra: bool}}\nlayers: {l: {c: @members; c.shape: class}}", "shared.d2": "c: {shape: class; \"+run()\": int; -x: string}", "members.d2": "\"#first()\": bool\n+second: int"}
	req["boards"] = "all"
	raw, _ := json.Marshal(req)
	var res map[string]any
	if err := json.Unmarshal(Handle(context.Background(), raw), &res); err != nil || res["error"] != nil {
		t.Fatal(err, res["error"])
	}
	for _, b := range res["boards"].([]any) {
		board := b.(map[string]any)
		var rows []any
		for _, o := range board["association"].(map[string]any)["objects"].([]any) {
			obj := o.(map[string]any)
			if obj["id"] == "c" {
				rows, _ = obj["rows"].([]any)
			}
		}
		want := map[string][]string{"": {"+run()", "-x"}, "/scenarios/s": {"+run()", "-x", "+extra"}, "/layers/l": {"#first()", "+second"}}[board["path"].(string)]
		var names []string
		for _, r := range rows {
			names = append(names, r.(map[string]any)["name"].(string))
		}
		if !reflect.DeepEqual(names, want) {
			t.Errorf("board %s rows %v, want %v", board["path"], names, want)
		}
	}
}

// Spec 0022: a property carries the range and kind of its value's own text, read from D2's syntax tree; non-literals have none.
func TestPropertyLiteralRangesAndKinds(t *testing.T) {
	text := "vars: {x: red}\na: {\n  shape: circle\n  style: {\n    bold: true\n    opacity: 0.5\n    fill: \"#3366cc\"\n    stroke: 'red'\n    font-color: ${x}\n  }\n}\nb: \"😀\" {style.fill: \"#fff\"}\nc: |md\n x\n|\n"
	res := compileText(t, text)
	props := map[string]map[string]any{}
	for _, o := range res["boards"].([]any)[0].(map[string]any)["association"].(map[string]any)["objects"].([]any) {
		obj := o.(map[string]any)
		props[obj["id"].(string)] = obj["properties"].(map[string]any)
	}
	pos := func(m any) int { return int(m.(map[string]any)["offset"].(float64)) }
	check := func(id, name, kind, want string) {
		t.Helper()
		lit, ok := props[id][name].(map[string]any)["literal"].(map[string]any)
		if !ok || lit["kind"] != kind {
			t.Fatalf("%s %s literal %v, want kind %s", id, name, props[id][name], kind)
		}
		units := utf16.Encode([]rune(text))
		got := string(utf16.Decode(units[pos(lit["start"]):pos(lit["end"])]))
		if got != want {
			t.Errorf("%s %s literal text %q, want %q", id, name, got, want)
		}
	}
	check("a", "shape", "unquoted", "circle")
	check("a", "bold", "bool", "true")
	check("a", "opacity", "number", "0.5")
	check("a", "fill", "double-quoted", "\"#3366cc\"")
	check("a", "stroke", "single-quoted", "'red'")
	check("b", "fill", "double-quoted", "\"#fff\"") // after an emoji: offsets are UTF-16
	fc, ok := props["a"]["fontColor"].(map[string]any)
	if !ok {
		t.Fatalf("a has no fontColor property: %v", props["a"])
	}
	if _, ok := fc["literal"]; ok {
		t.Errorf("a substitution has no literal, got %v", props["a"]["fontColor"])
	}
}
