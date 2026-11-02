import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The demo's `d2 --bundle` equivalent: remote image links in the editor become data URIs only in the copy sent to the compiler. Read from the page itself.
const html = readFileSync(new URL('../demo/index.html', import.meta.url), 'utf8');
const block = html.match(/\/\/ <inline-remote-images>[\s\S]*?\/\/ <\/inline-remote-images>/)[0];
const load = fetch => new Function('fetch', `${block}\nreturn { inlineRemoteImages, inlined };`)(fetch);
const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
const b64 = Buffer.from(svg).toString('base64');
const respond = (body, type = 'image/svg+xml') => ({ ok: true, headers: new Headers({ 'content-type': type }), arrayBuffer: async () => new TextEncoder().encode(body).buffer });

test('a bare link becomes a quoted data URI, a quoted one keeps its quotes', async () => {
  const { inlineRemoteImages } = load(async () => respond(svg));
  const { source, missing } = await inlineRemoteImages('a: {shape: image; icon: https://icons.terrastruct.com/dev%2Fgo.svg}\nb: {icon: "https://icons.terrastruct.com/dev%2Fgo.svg"}\nc: {icon: \'https://icons.terrastruct.com/dev%2Fgo.svg\'}');
  const data = `data:image/svg+xml;base64,${b64}`;
  assert.equal(source, `a: {shape: image; icon: "${data}"}\nb: {icon: "${data}"}\nc: {icon: '${data}'}`);
  assert.equal(missing, 0);
});

test('each link is fetched once, however often and wherever it appears', async () => {
  const seen = [];
  const { inlineRemoteImages } = load(async url => { seen.push(url); return respond(svg); });
  const text = 'x: {icon: https://i.test/a.svg}\ny: {icon: https://i.test/a.svg}\nz: {icon: https://i.test/b.png}';
  await inlineRemoteImages(text);
  await inlineRemoteImages(text);
  assert.deepEqual(seen.sort(), ['https://i.test/a.svg', 'https://i.test/b.png']);
});

test('a link that cannot be fetched stays a link, is counted, and other text is untouched', async () => {
  const { inlineRemoteImages } = load(async url => { if (url.endsWith('bad.svg')) throw new TypeError('network'); if (url.endsWith('gone.png')) return { ok: false, headers: new Headers() }; return respond(svg); });
  const text = 'a: {icon: https://i.test/bad.svg}\nb: {icon: https://i.test/gone.png}\nc: {icon: https://i.test/ok.svg}\nd: {link: https://d2lang.com/tour}';
  const { source, missing } = await inlineRemoteImages(text);
  assert.equal(missing, 2);
  assert.ok(source.includes('icon: https://i.test/bad.svg}') && source.includes('icon: https://i.test/gone.png}'));
  assert.ok(source.includes(`icon: "data:image/svg+xml;base64,${b64}"}`));
  assert.ok(source.includes('link: https://d2lang.com/tour}'));
});

test('a large image does not overflow the base64 conversion', async () => {
  const big = 'x'.repeat(300_000);
  const { inlineRemoteImages } = load(async () => respond(big, 'image/png; charset=binary'));
  const { source } = await inlineRemoteImages('a: {icon: https://i.test/big.png}');
  assert.ok(source.includes(`"data:image/png;base64,${Buffer.from(big).toString('base64')}"`));
});
