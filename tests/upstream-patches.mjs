import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './examples.mjs';

// docs/upstream/*.patch are opt-in fixes for the pinned D2 checkout (mise run reference:patch). The pristine tree stays the default
// so the bugs they fix remain demonstrable; this reports which state each patch is in.
const git = (...args) => spawnSync('git', ['-C', join(root, 'imports/d2'), ...args], { encoding: 'utf8' });

export const patches = () => globSync('docs/upstream/*.patch', { cwd: root }).sort().map(file => {
  const path = join(root, file);
  const state = git('apply', '--check', '--reverse', path).status === 0 ? 'applied' : git('apply', '--check', path).status === 0 ? 'pending' : 'conflict';
  return { file, path, state };
});

if (process.argv[2] === '--apply' || process.argv[2] === '--revert') {
  const want = process.argv[2] === '--apply';
  for (const p of patches()) {
    if (p.state === 'conflict') throw new Error(`${p.file} neither applies nor reverts cleanly on imports/d2`);
    if ((p.state === 'pending') === want) {
      const r = git('apply', ...(want ? [] : ['--reverse']), p.path);
      if (r.status !== 0) throw new Error(r.stderr);
    }
    console.log(`${p.file}: ${want ? 'applied' : 'reverted'}`);
  }
}
