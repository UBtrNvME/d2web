import { test, expect } from '@playwright/test';
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
