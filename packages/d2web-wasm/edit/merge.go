// Three-way line merge for spec 0012 §4, copied from research/roundtrip.go (merge3, equal, match), where the probe that validated it keeps its own copy.
package edit

// merge3 applies the change base -> theirs onto ours (diff3 over lines). Where ours and theirs both differ from base in one region, the
// author's lines are kept line for line when formatting only respelled them; otherwise theirs wins for that region, which is counted.
func merge3(base, ours, theirs []string) ([]string, int) {
	toOurs, toTheirs := match(base, ours), match(base, theirs)
	var out []string
	conflicts, i, a, b := 0, 0, 0, 0
	for {
		// The next base line kept on both sides is stable; everything before it is one region.
		k := i
		for k < len(base) && (toOurs[k] < 0 || toTheirs[k] < 0) {
			k++
		}
		oe, te := len(ours), len(theirs)
		if k < len(base) {
			oe, te = toOurs[k], toTheirs[k]
		}
		o, t, bs := ours[a:oe], theirs[b:te], base[i:k]
		switch {
		case equal(o, bs):
			out = append(out, t...)
		case equal(t, bs), equal(o, t):
			out = append(out, o...)
		case len(o) == len(bs):
			// Formatting changed these lines one for one: keep the author's spelling of each line the edit kept, take only its new lines.
			kept := map[int]int{}
			for j, at := range match(bs, t) {
				if at >= 0 {
					kept[at] = j
				}
			}
			for at, line := range t {
				if j, ok := kept[at]; ok {
					line = o[j]
				}
				out = append(out, line)
			}
		default:
			out = append(out, t...)
			conflicts++
		}
		if k == len(base) {
			return out, conflicts
		}
		out = append(out, base[k])
		i, a, b = k+1, oe+1, te+1
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// match maps each line of a to the line of b it is kept as (longest common subsequence), or -1.
func match(a, b []string) []int {
	m := make([][]int, len(a)+1)
	for i := range m {
		m[i] = make([]int, len(b)+1)
	}
	for i := len(a) - 1; i >= 0; i-- {
		for j := len(b) - 1; j >= 0; j-- {
			if a[i] == b[j] {
				m[i][j] = m[i+1][j+1] + 1
			} else {
				m[i][j] = max(m[i+1][j], m[i][j+1])
			}
		}
	}
	to := make([]int, len(a))
	for i := range to {
		to[i] = -1
	}
	for i, j := 0, 0; i < len(a) && j < len(b); {
		switch {
		case a[i] == b[j]:
			to[i] = j
			i, j = i+1, j+1
		case m[i+1][j] >= m[i][j+1]:
			i++
		default:
			j++
		}
	}
	return to
}
