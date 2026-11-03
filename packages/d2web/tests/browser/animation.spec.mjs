import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from './harness.mjs';

// Spec 0005: D2's animation tracks run as Web Animations inside the mount's shadow root; no extra API.
const host = '<div id="a" style="position:absolute;left:0;top:0"></div>';
const count = page => page.evaluate(() => document.getElementById('a').shadowRoot.getAnimations().length);
const update = (page, source) => page.evaluate(async source => {
  window.m ??= d2web.mount(document.getElementById('a'));
  await m.update(await compile(source));
}, source);

test('animated connections and shapes run as Web Animations; plain boards run none', async ({ page }) => {
  await open(page, { body: host });
  await update(page, 'a -> b');
  expect(await count(page)).toBe(0);
  await update(page, 'a -> b {style.animated: true}');
  expect(await count(page)).toBe(1); // one dash-offset track
  await update(page, 'x: Lift {style.animated: true}');
  expect(await count(page)).toBe(2); // transform and the merged drop-shadow filter
  await update(page, 'd <-> e {style.animated: true}');
  expect(await count(page)).toBe(2); // one per direction
});

test('the dash really moves and the animation is D2\'s: linear, repeating, its own duration', async ({ page }) => {
  await open(page, { body: host });
  await update(page, 'a -> b {style.animated: true}');
  const info = await page.evaluate(() => {
    const [anim] = document.getElementById('a').shadowRoot.getAnimations();
    const path = anim.effect.target;
    anim.pause();
    const offsetAt = t => { anim.currentTime = t; return getComputedStyle(path).strokeDashoffset; };
    return { first: offsetAt(0), later: offsetAt(1000), timing: anim.effect.getComputedTiming(), easing: anim.effect.getKeyframes()[0].easing };
  });
  expect(info.later).not.toBe(info.first);
  expect(info.timing.iterations).toBe(Infinity);
  expect(info.timing.duration).toBeGreaterThan(1000);
  expect(info.easing).toBe('linear');
});

test('replacing the board and disposing cancel the animations', async ({ page }) => {
  await open(page, { body: host });
  await update(page, 'x: Lift {style.animated: true}');
  const kept = await page.evaluate(() => document.getElementById('a').shadowRoot.getAnimations());
  expect(kept.length).toBeGreaterThan(0);
  await update(page, 'a -> b');
  expect(await count(page)).toBe(0);
  await update(page, 'a -> b {style.animated: true}');
  const states = await page.evaluate(() => { const list = document.getElementById('a').shadowRoot.getAnimations(); m.dispose(); return list.map(a => a.playState); });
  expect(states).toEqual(['idle']);
});

// Spec 0005 test plan step 3: the web animation and native D2's own CSS animation, paused at the same currentTime, hold the same dash offset.
test('an animated edge matches native D2 at equal currentTime', async ({ page }) => {
  const source = 'a -> b {style.animated: true}', dir = mkdtempSync(join(tmpdir(), 'anim-'));
  writeFileSync(join(dir, 'main.d2'), source);
  execFileSync('d2', ['--layout=tala', '--tala-seeds=1,2,3', '--bundle=true', '--animate-interval=0', '--pad=0', join(dir, 'main.d2'), join(dir, 'out.svg')], { stdio: 'pipe' });
  const svg = readFileSync(join(dir, 'out.svg'), 'utf8');
  await open(page, { body: host + '<div id="n"></div>' });
  await update(page, source);
  const times = [0, 250, 750, 1500];
  const [web, nat] = await page.evaluate(async ({ svg, times }) => {
    document.getElementById('n').innerHTML = svg;
    const offset = (anim, t) => { anim.pause(); anim.currentTime = t; return +getComputedStyle(anim.effect.target).strokeDashoffset.replace('px', ''); };
    const w = document.getElementById('a').shadowRoot.getAnimations()[0];
    const n = document.getAnimations().find(x => x.animationName === 'dashdraw');
    return [times.map(t => offset(w, t)), times.map(t => offset(n, t))];
  }, { svg, times });
  expect(nat.some(v => v !== nat[0])).toBe(true); // the native dash really moves
  web.forEach((v, i) => expect(v).toBeCloseTo(nat[i], 1));
});

test('an animated shape matches native D2 at equal currentTime (transform and drop-shadow)', async ({ page }) => {
  const source = 'x: Lift {style.animated: true}', dir = mkdtempSync(join(tmpdir(), 'anim-'));
  writeFileSync(join(dir, 'main.d2'), source);
  execFileSync('d2', ['--layout=tala', '--tala-seeds=1,2,3', '--bundle=true', '--animate-interval=0', '--pad=0', join(dir, 'main.d2'), join(dir, 'out.svg')], { stdio: 'pipe' });
  await open(page, { body: host + '<div id="n"></div>' });
  await update(page, source);
  const times = [0, 250, 500, 750];
  const [web, nat] = await page.evaluate(async ({ svg, times }) => {
    document.getElementById('n').innerHTML = svg;
    const web = document.getElementById('a').shadowRoot.getAnimations(), native = document.getAnimations().find(x => x.animationName === 'shapeappear');
    const read = el => { const s = getComputedStyle(el); return [s.transform, s.filter]; };
    const at = (list, el, t) => { for (const a of list) { a.pause(); a.currentTime = t; } return read(el); };
    return [times.map(t => at(web, web[0].effect.target, t)), times.map(t => at([native], native.effect.target, t))];
  }, { svg: readFileSync(join(dir, 'out.svg'), 'utf8'), times });
  expect(nat[2]).not.toEqual(nat[0]); // the native shape really moves
  expect(web).toEqual(nat);
});
