// Diagnostic experiment: a copy-on-write wrapper around d2oracle, not a public editing contract.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing/fstest"

	"github.com/d2lang/d2/d2compiler"
	"github.com/d2lang/d2/d2format"
	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2oracle"
)

type edit struct {
	Name string `json:"name"`
	Op   string `json:"op"` // set | rename | delete
	Key  string `json:"key"`
	Arg  string `json:"arg"`
	// Board is the board path (layers, scenarios, steps); empty edits the entry board.
	Board []string `json:"board"`
}
type request struct {
	Entry string            `json:"entry"`
	Files map[string]string `json:"files"`
	Edits []edit            `json:"edits"`
}
type outcome struct {
	Name      string            `json:"name"`
	OK        bool              `json:"ok"`
	Error     string            `json:"error"`
	Entry     string            `json:"entry"`
	Deltas    map[string]string `json:"deltas"`
	Recompile string            `json:"recompileError"`
	Panic     string            `json:"panic"`
	// Direct is the entry text left behind in the supplied graph by calling the oracle without the wrapper.
	Direct string `json:"direct"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func compile(entry string, files map[string]string, text string) (*compiled, error) {
	fs := fstest.MapFS{}
	for path, contents := range files {
		fs[path] = &fstest.MapFile{Data: []byte(contents)}
	}
	graph, _, err := d2compiler.Compile(entry, strings.NewReader(text), &d2compiler.CompileOptions{FS: fs, UTF16Pos: true})
	return &compiled{graph}, err
}

func run() error {
	var input request
	if len(os.Args) != 2 || json.Unmarshal([]byte(os.Args[1]), &input) != nil {
		return fmt.Errorf("expected JSON workspace")
	}
	source := input.Files[input.Entry]
	var results []outcome
	for _, e := range input.Edits {
		result := outcome{Name: e.Name}
		// Wrapper: edit a disposable graph, publish only text that recompiles.
		disposable, err := compile(input.Entry, input.Files, source)
		if err != nil {
			return err
		}
		deltas, err := e.apply(disposable, &result)
		if result.Panic != "" {
			result.Error = "panic"
		} else if err != nil {
			result.Error = err.Error()
		} else {
			result.Deltas = deltas
			result.Entry = d2format.Format(disposable.graph.AST)
			if _, err := compile(input.Entry, input.Files, result.Entry); err != nil {
				result.Recompile = err.Error()
			} else {
				result.OK = true
			}
		}
		// Contrast: the same edit applied directly to a graph that stays in use.
		direct, _ := compile(input.Entry, input.Files, source)
		_, _ = e.apply(direct, &outcome{})
		result.Direct = d2format.Format(direct.graph.AST)
		results = append(results, result)
	}
	return json.NewEncoder(os.Stdout).Encode(results)
}

type compiled struct{ graph *d2graph.Graph }

func (c *compiled) set(board []string, key, value string) error {
	_, err := d2oracle.Set(c.graph, board, key, nil, &value)
	return err
}

func (c *compiled) rename(board []string, key, name string) (map[string]string, error) {
	deltas, err := d2oracle.RenameIDDeltas(c.graph, board, key, name)
	if err != nil {
		return nil, err
	}
	_, _, err = d2oracle.Rename(c.graph, board, key, name)
	return deltas, err
}

func (c *compiled) remove(board []string, key string) (map[string]string, error) {
	deltas, err := d2oracle.DeleteIDDeltas(c.graph, board, key)
	if err != nil {
		return nil, err
	}
	_, err = d2oracle.Delete(c.graph, board, key)
	return deltas, err
}

// apply runs one edit and converts an oracle panic into a recorded outcome; d2oracle does not guard its own nil dereferences.
func (e edit) apply(g *compiled, result *outcome) (deltas map[string]string, err error) {
	defer func() {
		if r := recover(); r != nil {
			result.Panic = fmt.Sprint(r)
		}
	}()
	switch e.Op {
	case "set":
		return nil, g.set(e.Board, e.Key, e.Arg)
	case "rename":
		return g.rename(e.Board, e.Key, e.Arg)
	}
	return g.remove(e.Board, e.Key)
}
