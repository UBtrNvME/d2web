// Every backticked repo path and mise task named in docs/adr and docs/specs must exist.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const tasks = new Set([...readFileSync('mise.toml', 'utf8').matchAll(/^\[tasks\."?([^"\]]+)"?\]/gm)].map(m => m[1]));
const roots = ['packages/', 'docs/', 'tests/', 'research/', 'examples/', 'tasks/', '.github/', 'imports/'];
const files = ['docs/adr', 'docs/specs'].flatMap(d => readdirSync(d).filter(f => f.endsWith('.md')).map(f => join(d, f)));

test('paths and mise tasks cited in ADRs and specs exist', () => {
  const missing = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const [, tok] of text.matchAll(/`([^`\n]+)`/g)) {
      const path = tok.replace(/[:#].*$/, '').replace(/\/$/, '');
      if (roots.some(r => path.startsWith(r)) && !/[*{}<>\s]/.test(path) && !/(^|\/)(dist|artifacts|node_modules)(\/|$)/.test(path) && !existsSync(path)) missing.push(`${file}: ${tok}`);
      const run = tok.match(/^mise run (\S+)/)?.[1];
      if (run && !tasks.has(run)) missing.push(`${file}: task ${run}`);
    }
    for (const [, link] of text.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
      if (!/^https?:/.test(link) && !existsSync(join(dirname(file), link))) missing.push(`${file}: link ${link}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every spec states whether it is delivered', () => {
  const bad = files.filter(f => f.startsWith('docs/specs/') && !/^Delivered: /m.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad, []);
});
