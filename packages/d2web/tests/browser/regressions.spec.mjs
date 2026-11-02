import { test, expect } from '@playwright/test';
import { open } from './harness.mjs';

const host = '<div id="scale" style="transform:scale(1);transform-origin:0 0"><div id="a" style="position:absolute;left:0;top:0"></div></div>';

test('text baselines stay scene-aligned when an ancestor scales across updates', async ({ page }) => {
  await open(page, { body: host });
  const source = 'md: |md\n# Heading\n\nBody\n|\na: "first\\nsecond"\nb: "third\\nfourth"\na -> b: "edge\\nlabel"';
  const out = await page.evaluate(async source => {
    const cases = [];
    for (const markdown of ['positioned', 'flow']) {
      const mount = d2web.mount(document.getElementById('a'), { markdown });
      for (const renderScale of [undefined, 1.5]) {
        const result = await compile(source, renderScale === undefined ? {} : { scale: renderScale });
        document.getElementById('scale').style.transform = 'scale(1)';
        await mount.update(result);
        const sample = scale => {
          const scene = document.querySelector('#a').shadowRoot.querySelector('[data-d2-scene]');
          const rect = scene.getBoundingClientRect();
          const markers = [...scene.querySelectorAll('[data-k="text"]')].map(el => {
            const marker = el.querySelector('[data-baseline]').getBoundingClientRect();
            return (marker.top - rect.top) / scale;
          });
          const heading = scene.querySelector('h1');
          const headingRuns = [...heading.querySelectorAll('[data-k="text"]')].map(el => el.getBoundingClientRect()).filter(r => r.width && r.height);
          const flow = scene.querySelector('[data-flow-markdown]');
          const clip = scene.querySelector('[data-id="md:markdown"]');
          const headingBox = heading.getBoundingClientRect();
          const clipBox = (flow ?? clip).getBoundingClientRect();
          const headingFits = flow
            ? headingBox.width > 0 && headingBox.height > 0 && getComputedStyle(flow).overflow === 'visible'
            : headingRuns.length > 0 && getComputedStyle(clip).clipPath !== 'none' && headingRuns.every(r => r.top >= clipBox.top - 0.5 && r.bottom <= clipBox.bottom + 0.5);
          return { markers, headingFits };
        };
        const reference = sample(1);
        await mount.update(result); // same-result repaint at scale 1 must preserve the reference geometry
        const repeated = sample(1);
        const samples = [];
        for (const scale of [0.4, 0.75, 1, 1.5, 2]) {
          document.getElementById('scale').style.transform = `scale(${scale})`;
          await mount.update(result);
          samples.push(sample(scale));
        }
        cases.push({ markdown, renderScale, reference, repeated, samples });
      }
      mount.dispose();
    }
    return cases;
  }, source);
  for (const { markdown, renderScale, reference, repeated, samples } of out) {
    expect(reference.markers.length).toBeGreaterThanOrEqual(5);
    expect(repeated.markers).toEqual(reference.markers);
    for (const sample of samples) {
      expect(sample.markers.length).toBe(reference.markers.length);
      sample.markers.forEach((y, i) => expect(y, `${markdown}, render.scale=${renderScale}, baseline ${i}`).toBeCloseTo(reference.markers[i], 1));
      expect(sample.headingFits, `${markdown}, render.scale=${renderScale}: heading remains visible within its D2 clipping contract`).toBe(true);
    }
  }
});

test('animated Lift keeps its named D2 group around consumer content and events', async ({ page }) => {
  await open(page, { body: '<div id="a"></div>' });
  await page.evaluate(async () => {
    window.m = d2web.mount(document.getElementById('a'));
    window.clicked = [];
    m.on('click', e => clicked.push(e.id));
    await m.update(await compile('x: Lift {style.animated: true}'));
    const button = document.createElement('button');
    button.textContent = 'Consumer action';
    button.onclick = () => { window.activated = true; };
    m.setNodeContent('x', button);
  });
  const button = page.getByRole('button', { name: 'Consumer action' });
  await expect(button).toBeVisible();
  await button.click();
  expect(await page.evaluate(() => window.activated)).toBe(true);
  expect(await page.evaluate(() => clicked)).toEqual(['x']);
  const group = page.getByRole('group', { name: 'Lift', exact: true });
  await expect(group).toHaveCount(1);
  await expect(group).toHaveAttribute('data-id', 'x');
  await expect(group).toHaveAttribute('tabindex', '0');
  await group.focus();
  await expect(group).toBeFocused();
});

test('disposing during FontFace.load releases the late face', async ({ page }) => {
  await open(page, { body: '<div id="a"></div><div id="b"></div>' });
  const pending = await page.evaluate(async () => {
    const NativeFontFace = FontFace;
    let resolveLoad;
    try {
      window.FontFace = class extends NativeFontFace {
        load() { return super.load().then(face => new Promise(resolve => { resolveLoad = () => resolve(face); })); }
      };
      const result = await compile('a -> b');
      const mount = d2web.mount(document.getElementById('a'));
      const before = document.fonts.size;
      const update = mount.update(result);
      while (!resolveLoad) await new Promise(resolve => setTimeout(resolve, 0));
      mount.dispose();
      resolveLoad();
      await update.catch(() => {});
      return document.fonts.size - before;
    } finally { window.FontFace = NativeFontFace; }
  });
  expect(pending).toBe(0);
});

test('concurrent mounts acquire each font only once and release it with the last mount', async ({ page }) => {
  await open(page, { body: '<div id="a"></div><div id="b"></div>' });
  const concurrent = await page.evaluate(async () => {
    const NativeFontFace = FontFace;
    let loads = 0;
    try {
      window.FontFace = class extends NativeFontFace {
        load() { loads++; return super.load(); }
      };
      const result = await compile('a -> b');
      const before = document.fonts.size;
      const a = d2web.mount(document.getElementById('a'));
      const b = d2web.mount(document.getElementById('b'));
      await Promise.all([a.update(result), b.update(result)]);
      const whileShared = document.fonts.size - before;
      a.dispose(); b.dispose();
      const after = document.fonts.size - before;
      return { loads, uniqueFamilies: Object.keys(result.fonts).length, whileShared, after };
    } finally { window.FontFace = NativeFontFace; }
  });
  expect(concurrent.loads).toBe(concurrent.uniqueFamilies);
  expect(concurrent.whileShared).toBe(concurrent.uniqueFamilies);
  expect(concurrent.after).toBe(0);
});

test('each inline Markdown link is named by its link text and keeps its object group name', async ({ page }) => {
  await open(page, { body: '<div id="a"></div>' });
  const markdown = '[Guide](https://one.example) and [Reference](https://two.example)';
  await page.evaluate(async markdown => {
    const source = `doc: |md\n${markdown}\n|`;
    window.m = d2web.mount(document.getElementById('a'));
    await m.update(await compile(source));
  }, markdown);
  const group = page.getByRole('group', { name: markdown, exact: true });
  await expect(group).toHaveCount(1);
  await expect(group.getByRole('link', { name: 'Guide', exact: true })).toHaveAttribute('href', 'https://one.example');
  await expect(group.getByRole('link', { name: 'Reference', exact: true })).toHaveAttribute('href', 'https://two.example');
});
