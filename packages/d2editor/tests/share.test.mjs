import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeScript, decodeScript } from '../src/share.ts';

const script = 'x -> y\nI just forgot my whole philosophy of life!!!: {\n  s: TV is chewing gum for the eyes\n}\n';
// Go's output for `script` with the calls of D2 v0.9.0 lib/urlenc.Encode (flate BestCompression, no dictionary, base64.URLEncoding).
const fromGo = 'FMvBDcIwDEDRe6b4GYAFeuDOHbEAcmKjFFc4VbEQuyMGeG9OZ7JceOwxaf7qPlmTQ30Im9rw8E0TbwxrUmtd-BSIhesNC-4qhz07fV__nqmCpET5lt8A';

test("decodes D2's own encoding and round-trips unicode text", async () => {
  assert.equal(await decodeScript(fromGo), script);
  const text = 'a: "Ünïcode ✓ 日本"\na -> b\n'.repeat(50);
  const encoded = await encodeScript(text);
  assert.match(encoded, /^[A-Za-z0-9_=-]+$/);
  assert.equal(await decodeScript(encoded), text);
});

test('refuses a link that inflates past the limit, and malformed input', async () => {
  const big = await encodeScript('a'.repeat(10_000));
  await assert.rejects(decodeScript(big, 1000), /larger than 1000 bytes/);
  await assert.rejects(decodeScript('not base64 !!'));
});
