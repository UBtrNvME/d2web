import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animationSpecs } from '../src/animation.js';

// Spec 0005: each scene track becomes one Web Animations call; D2 supplies every number.
const lin = { Kind: 0, X1: 0, Y1: 0, X2: 0, Y2: 0 };
const ident = { A: 1, B: 0, C: 0, D: 1, E: 0, F: 0 };
const shadow = (y, sigma, color) => ({ Kind: 3, Shadow: { OffsetX: 0, OffsetY: y, SigmaX: sigma, SigmaY: sigma, Color: color } });
const track = (Property, keyframes, extra = {}) => ({ Property, TargetIndex: 0, Delay: 0, Duration: 2_000_000_000, Repeat: true, Keyframes: keyframes.map(([Offset, Value, Easing = lin]) => ({ Offset, Value, Easing })), ...extra });
const number = n => ({ Kind: 0, Number: n });

test('a dash-offset track becomes a repeating stroke-dashoffset animation on the painted path', () => {
  const [spec] = animationSpecs({ Transform: ident, Animations: [track(2, [[0, number(0)], [1, number(-20)]])] });
  assert.equal(spec.target, 'primitive');
  assert.deepEqual(spec.keyframes.map(k => [k.offset, k.strokeDashoffset, k.easing]), [[0, '0px', 'linear'], [1, '-20px', 'linear']]);
  assert.deepEqual(spec.options, { delay: 0, duration: 2000, iterations: Infinity, fill: 'both' });
});

test('delay, no repeat and every easing kind map to their CSS forms', () => {
  const [spec] = animationSpecs({ Transform: ident, Animations: [track(0, [
    [0, number(1), { Kind: 1, X1: .1, Y1: .2, X2: .3, Y2: .4 }], [.5, number(.5), { Kind: 2 }], [1, number(1), { Kind: 3 }]], { Delay: 500_000_000, Repeat: false })] });
  assert.equal(spec.target, 'node');
  assert.deepEqual(spec.keyframes.map(k => [k.opacity, k.easing]), [[1, 'cubic-bezier(0.1,0.2,0.3,0.4)'], [.5, 'steps(1, start)'], [1, 'steps(1, end)']]);
  assert.deepEqual(spec.options, { delay: 500, duration: 2000, iterations: 1, fill: 'both' });
});

test('a transform track keeps the node\'s own transform in front of D2\'s value', () => {
  const base = { A: 1, B: 0, C: 0, D: 1, E: 10, F: 20 };
  const [spec] = animationSpecs({ Transform: base, Animations: [track(1, [[0, { Kind: 1, Transform: ident }], [1, { Kind: 1, Transform: { ...ident, F: -4 } }]])] });
  assert.deepEqual(spec.keyframes.map(k => k.transform), ['matrix(1,0,0,1,10,20) matrix(1,0,0,1,0,0)', 'matrix(1,0,0,1,10,20) matrix(1,0,0,1,0,-4)']);
});

test('colour tracks target the painted primitive', () => {
  const colour = c => ({ Kind: 2, Color: c });
  const specs = animationSpecs({ Transform: ident, Animations: [track(3, [[0, colour('rgba(1,2,3,1.0000)')], [1, colour('rgba(4,5,6,1.0000)')]]), track(4, [[0, colour('rgba(1,2,3,1.0000)')], [1, colour('rgba(4,5,6,1.0000)')]])] });
  assert.deepEqual(specs.map(s => [s.target, Object.keys(s.keyframes[0]).filter(k => k !== 'offset' && k !== 'easing')]), [['primitive', ['fill']], ['primitive', ['stroke']]]);
});

test('indexed drop-shadow tracks on one node merge into a single filter animation', () => {
  const t0 = track(5, [[0, shadow(0, 0, 'rgba(0,0,0,0.0000)')], [.5, shadow(12.6, 25.2, 'rgba(50,50,93,0.2500)')], [1, shadow(0, 0, 'rgba(0,0,0,0.0000)')]]);
  const t1 = track(5, [[0, shadow(0, 0, 'rgba(0,0,0,0.0000)')], [.5, shadow(7.56, 15.12, 'rgba(0,0,0,0.3000)')], [1, shadow(0, 0, 'rgba(0,0,0,0.0000)')]], { TargetIndex: 1 });
  const specs = animationSpecs({ Transform: ident, Animations: [t0, t1] });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].keyframes[1].filter, 'drop-shadow(rgba(50,50,93,0.2500) 0px 12.6px 25.2px) drop-shadow(rgba(0,0,0,0.3000) 0px 7.56px 15.12px)');
});

test('drop-shadow tracks with different timing are refused, not guessed', () => {
  const a = track(5, [[0, shadow(0, 0, 'rgba(0,0,0,0)')], [1, shadow(0, 0, 'rgba(0,0,0,0)')]]);
  const b = track(5, [[0, shadow(0, 0, 'rgba(0,0,0,0)')], [1, shadow(0, 0, 'rgba(0,0,0,0)')]], { TargetIndex: 1, Duration: 1_000_000_000 });
  assert.throws(() => animationSpecs({ Transform: ident, Animations: [a, b] }), /drop-shadow/);
});

test('an unknown property or value kind is an error', () => {
  assert.throws(() => animationSpecs({ Transform: ident, Animations: [track(9, [[0, number(0)], [1, number(1)]])] }), /animation property/);
});
