package edit

import "testing"

func TestGridProbe(t *testing.T) {
	g := "g: {\n  grid-rows: 2\n  grid-columns: 3\n  a\n  b\n}\n"
	seq := "s: {\n  shape: sequence_diagram\n  a -> b: hi\n}\n"
	cases := []struct {
		name, text string
		ops        []Op
	}{
		{"delete grid-rows", g, []Op{{Op: "delete", Key: "g.grid-rows"}}},
		{"delete both", g, []Op{{Op: "delete", Key: "g.grid-rows"}, {Op: "delete", Key: "g.grid-columns"}}},
		{"set grid-rows", g, []Op{{Op: "set", Key: "g.grid-rows", Value: str("4")}}},
		{"set direction", "g: {a}\n", []Op{{Op: "set", Key: "g.direction", Value: str("right")}}},
		{"delete direction", "g: {direction: right\n  a}\n", []Op{{Op: "delete", Key: "g.direction"}}},
		{"seq create actor", seq, []Op{{Op: "create", Key: "s.c"}}},
		{"seq create message", seq, []Op{{Op: "create", Key: "s.b -> s.a"}}},
		{"seq set message label", seq, []Op{{Op: "set", Key: "s.(a -> b)[0]", Value: str("changed")}}},
		{"delete message", seq, []Op{{Op: "delete", Key: "s.(a -> b)[0]"}}},
		{"set shape seq", "s: {a -> b}\n", []Op{{Op: "set", Key: "s.shape", Value: str("sequence_diagram")}}},
		{"shape rectangle on seq", seq, []Op{{Op: "set", Key: "s.shape", Value: str("rectangle")}}},
	}
	for _, c := range cases {
		res := Apply(Request{ID: 1, Files: map[string]string{"main.d2": c.text}, Entry: "main.d2", Ops: c.ops})
		if res.Error != nil {
			t.Logf("%-26s ERROR %s: %.100s", c.name, res.Error.Code, res.Error.Message)
		} else if res.Patch.Text == c.text {
			t.Logf("%-26s NO-OP", c.name)
		} else {
			t.Logf("%-26s OK\n%s", c.name, res.Patch.Text)
		}
	}
}
