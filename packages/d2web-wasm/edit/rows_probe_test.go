package edit

import "testing"

func TestRowsProbe(t *testing.T) {
	tbl := "t: {\n  shape: sql_table\n  id: int {constraint: primary_key}\n  name: varchar\n}\n"
	cls := "c: {\n  shape: class\n  +name: string\n  \"+run(x int)\": bool\n}\n"
	cases := []struct {
		name, text string
		ops        []Op
	}{
		{"set nil row", tbl, []Op{{Op: "set", Key: "t.name"}}},
		{"delete row", tbl, []Op{{Op: "delete", Key: "t.name"}}},
		{"rename row", tbl, []Op{{Op: "rename", Key: "t.name", Name: "title"}}},
		{"set row type", tbl, []Op{{Op: "set", Key: "t.name", Value: str("text")}}},
		{"set constraint", tbl, []Op{{Op: "set", Key: "t.name.constraint", Value: str("unique")}}},
		{"delete constraint", tbl, []Op{{Op: "delete", Key: "t.id.constraint"}}},
		{"create row", tbl, []Op{{Op: "create", Key: "t.email"}}},
		{"set new row", tbl, []Op{{Op: "set", Key: "t.email", Value: str("text")}}},
		{"delete table row via parent delete", tbl, []Op{{Op: "delete", Key: "t.id"}}},
		{"class set field", cls, []Op{{Op: "set", Key: "c.\"-age\"", Value: str("int")}}},
		{"class delete field", cls, []Op{{Op: "delete", Key: "c.\"+name\""}}},
	}
	for _, c := range cases {
		res := Apply(Request{ID: 1, Files: map[string]string{"main.d2": c.text}, Entry: "main.d2", Ops: c.ops})
		if res.Error != nil {
			t.Logf("%-34s ERROR %s: %.110s", c.name, res.Error.Code, res.Error.Message)
		} else if res.Patch.Text == c.text {
			t.Logf("%-34s NO-OP", c.name)
		} else {
			t.Logf("%-34s OK\n%s", c.name, res.Patch.Text)
		}
	}
}
