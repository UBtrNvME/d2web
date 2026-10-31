// Spec 0005: translate scene animation tracks to Web Animations API calls. D2 supplies every number; nothing here adds timing or policy.
const num = n => +n.toFixed(6);
const EASING = e => [() => 'linear', () => `cubic-bezier(${num(e.X1)},${num(e.Y1)},${num(e.X2)},${num(e.Y2)})`, () => 'steps(1, start)', () => 'steps(1, end)'][e.Kind]();
const matrix = m => `matrix(${[m.A, m.B, m.C, m.D, m.E, m.F].map(num).join(',')})`;
const identity = m => m.A === 1 && m.B === 0 && m.C === 0 && m.D === 1 && m.E === 0 && m.F === 0;
const shadow = s => `drop-shadow(${s.Color} ${num(s.OffsetX)}px ${num(s.OffsetY)}px ${num(s.SigmaX)}px)`;

// AnimationProperty enum order in d2scene/animation.go; `target` is the element the CSS property must reach (a primitive's own fill and stroke
// attributes win over anything inherited from its group).
const PROPERTIES = [
  { css: 'opacity', target: 'node', value: (v) => v.Number },
  { css: 'transform', target: 'node', value: (v, node) => (identity(node.Transform) ? matrix(v.Transform) : `${matrix(node.Transform)} ${matrix(v.Transform)}`) },
  { css: 'strokeDashoffset', target: 'primitive', value: v => `${num(v.Number)}px` },
  { css: 'fill', target: 'primitive', value: v => v.Color },
  { css: 'stroke', target: 'primitive', value: v => v.Color },
];
const DROP_SHADOW = 5;

const options = t => ({ delay: t.Delay / 1e6, duration: t.Duration / 1e6, iterations: t.Repeat ? Infinity : 1, fill: 'both' });
const frames = (t, css, value) => t.Keyframes.map(k => ({ offset: k.Offset, easing: EASING(k.Easing), [css]: value(k.Value) }));

// Returns [{ target: 'node' | 'primitive', keyframes, options }] for one scene node, in track order.
export function animationSpecs(node) {
  const specs = [];
  const shadows = [];
  for (const t of node.Animations ?? []) {
    if (t.Property === DROP_SHADOW) { shadows.push(t); continue; }
    const p = PROPERTIES[t.Property];
    if (!p) throw new Error(`unknown animation property ${t.Property}`);
    specs.push({ target: p.target, keyframes: frames(t, p.css, v => p.value(v, node)), options: options(t) });
  }
  if (shadows.length) {
    // CSS has one `filter` property, so the node's indexed shadows must share one animation (they animate together in D2's scene).
    const [first] = shadows;
    const same = t => t.Delay === first.Delay && t.Duration === first.Duration && t.Repeat === first.Repeat && t.Keyframes.length === first.Keyframes.length && t.Keyframes.every((k, i) => k.Offset === first.Keyframes[i].Offset);
    if (!shadows.every(same)) throw new Error('drop-shadow tracks on one node with different timing');
    const ordered = [...shadows].sort((a, b) => a.TargetIndex - b.TargetIndex);
    specs.push({ target: 'node', keyframes: first.Keyframes.map((k, i) => ({ offset: k.Offset, easing: EASING(k.Easing), filter: ordered.map(t => shadow(t.Keyframes[i].Value.Shadow)).join(' ') })), options: options(first) });
  }
  return specs;
}
