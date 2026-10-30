import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { root } from '../examples.mjs';
import { compare } from './compare.mjs';

test('React geometry matches native D2 and updates the existing DOM', async ({ page }, info) => {
  const directory = join(root, 'artifacts/scene-probe');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await compare(page, join(directory, 'native.svg'), join(directory, 'react.html'), info, directory);
  await expect(page.getByRole('img', { name: 'Geometry example' })).toHaveCount(1);
  await expect(page.locator('svg')).toHaveCount(1);
  await expect(page.locator('rect')).toHaveCount(2);
  await expect(page.locator('ellipse')).toHaveCount(1);
  await expect(page.locator('path')).toHaveCount(2);
  await expect(page.locator('image, foreignObject')).toHaveCount(0);
  await expect(page.locator('[data-d2-id="source"] rect')).toHaveAttribute('stroke-width', '3');
  await page.locator('[data-d2-scene]').screenshot({ path: join(directory, 'react.png') });
  const source = page.locator('[data-d2-id="source"] rect');
  await source.evaluate(element => { window.originalSourceElement = element; });
  await page.evaluate(() => {
    const scene = structuredClone(window.geometryFixture);
    scene.Root.Children.find(node => node.ID === 'source').Children[0].Primitive.Fill.Color.R = 12;
    window.renderGeometry(scene);
  });
  await expect(source).toHaveAttribute('fill', 'rgba(12, 107, 107, 1)');
  expect(await source.evaluate(element => element === window.originalSourceElement)).toBe(true);
  expect(errors).toEqual([]);
});
