import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function scenePairs(nativeRoot, webRoot) {
  for (const path of globSync('**/case.json', { cwd: nativeRoot })) {
    assert.equal(JSON.parse(readFileSync(join(nativeRoot, path), 'utf8')).status, 0, `Native compilation failed: ${path}`);
  }
  const native = [...globSync('**/*.svg', { cwd: nativeRoot })].sort();
  assert(native.length > 0, 'No native SVGs. Run mise run test:native first');
  const expected = native.map(path => path.replace(/\.svg$/, '.html'));
  assert.deepEqual([...globSync('**/*.html', { cwd: webRoot })].sort(), expected, 'Missing or extra web diagrams/boards');
  return native.map((path, i) => ({ name: path, native: join(nativeRoot, path), web: join(webRoot, expected[i]) }));
}
