// Diagnostic native-operation experiment, not a public editing contract.
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
	"github.com/d2lang/d2/d2target"
)

type request struct {
	Entry string            `json:"entry"`
	Files map[string]string `json:"files"`
}
type operation struct {
	Board       []string `json:"board"`
	Key         string   `json:"key"`
	Value       string   `json:"value"`
	Before      string   `json:"before"`
	After       string   `json:"after"`
	ReturnedNil bool     `json:"returnedNil"`
	Error       string   `json:"error"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	if len(os.Args) != 2 {
		return fmt.Errorf("expected JSON workspace")
	}
	var input request
	if err := json.Unmarshal([]byte(os.Args[1]), &input); err != nil {
		return err
	}
	text, ok := input.Files[input.Entry]
	if !ok {
		return fmt.Errorf("entry missing")
	}
	files := fstest.MapFS{}
	for path, contents := range input.Files {
		files[path] = &fstest.MapFile{Data: []byte(contents)}
	}
	var operations []operation
	for _, item := range []struct {
		key, value string
		board      []string
	}{
		{"local.style.fill", "#112233", nil},
		{"local.style.opacity", "2", nil},
		{"imported.child.style.fill", "#112233", nil},
		{"local.label", "edited", []string{"changed"}},
	} {
		graph, _, err := d2compiler.Compile(input.Entry, strings.NewReader(text), &d2compiler.CompileOptions{FS: files, UTF16Pos: true})
		if err != nil {
			return err
		}
		result := operation{Board: item.board, Key: item.key, Value: item.value, Before: d2format.Format(graph.AST)}
		updated, err := d2oracle.Set(graph, item.board, item.key, nil, &item.value)
		result.After, result.ReturnedNil = d2format.Format(graph.AST), updated == nil
		if err != nil {
			result.Error = err.Error()
		}
		operations = append(operations, result)
	}
	// Existing premeasurement keys describe text, not independently sized objects.
	first := &d2target.MText{Text: "equal label", FontSize: 16, Dimensions: d2target.TextDimensions{Width: 100, Height: 20}}
	second := &d2target.MText{Text: "equal label", FontSize: 16, Dimensions: d2target.TextDimensions{Width: 240, Height: 80}}
	measured := []*d2target.MText{first, second}
	firstDimensions := d2graph.GetTextDimensions(measured, nil, first, nil)
	secondDimensions := d2graph.GetTextDimensions(measured, nil, second, nil)
	return json.NewEncoder(os.Stdout).Encode(struct {
		Operations []operation              `json:"operations"`
		First      *d2target.TextDimensions `json:"firstMeasurement"`
		Second     *d2target.TextDimensions `json:"secondMeasurement"`
	}{operations, firstDimensions, secondDimensions})
}
