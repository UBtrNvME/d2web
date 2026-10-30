import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../examples.mjs';
import { compare } from './compare.mjs';

for (const shifted of [false, true]) {
  test(shifted ? 'comparison detects a displaced drawing' : 'comparison accepts identical drawings', async ({ page }, info) => {
    const native = join(root, 'artifacts/native/imports/default/diagram.svg');
    const svg = readFileSync(native, 'utf8').replace(/^[\s\S]*?(?=<svg)/, '');
    const candidate = info.outputPath('candidate.html');
    writeFileSync(info.outputPath('candidate.mjs'), `document.body.innerHTML = ${JSON.stringify(`<div data-d2-scene style="width:max-content;line-height:0">${svg}</div>`)};`);
    writeFileSync(candidate, `<head>${shifted ? '<style>svg{transform:translateX(20px)}</style>' : ''}</head><body style="margin:0"><script type="module" src="./candidate.mjs"></script>`);
    if (shifted) await expect(compare(page, native, candidate, info)).rejects.toThrow(/toMatchSnapshot|pixel/);
    else await compare(page, native, candidate, info);
  });
}
