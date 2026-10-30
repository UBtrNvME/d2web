import assert from 'node:assert/strict';
import { test } from '@playwright/test';
import { join, resolve } from 'node:path';
import { root } from '../examples.mjs';
import { scenePairs } from '../scene-pairs.mjs';
import { compare } from './compare.mjs';

const webRoot = process.env.D2_WEB_OUTPUT;
// The web renderer supplies standalone HTML scenes, preserving React's actual output.
assert(webRoot, 'Set D2_WEB_OUTPUT to the web-rendered HTML directory; see docs/conformance.md');
const nativeRoot = resolve(process.env.D2_NATIVE_OUTPUT ?? join(root, 'artifacts/native'));
for (const pair of scenePairs(nativeRoot, resolve(webRoot))) {
  test(pair.name, async ({ page }, info) => {
    await compare(page, pair.native, pair.web, info, resolve(webRoot));
  });
}
