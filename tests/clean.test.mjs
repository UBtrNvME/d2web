import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

test('cleanup removes generated data, preserves source/state, and refuses symlinked parents', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'd2-clean-'));
  const root = join(temporary, 'repo');
  const script = join(root, 'scripts/clean.mjs');
  const studio = 'imports/d2-architecture-studio';
  const keep = ['.git/config', 'examples/case.d2', 'imports/d2/compiler.go',
    'node_modules/package/index.js', `${studio}/.git/config`, `${studio}/app/page.tsx`,
    `${studio}/pnpm-lock.yaml`, `${studio}/node_modules/package/index.js`,
    `${studio}/.wrangler/state/database.sqlite`, `${studio}/.sites-runtime/execution-profile.json`];
  const remove = ['artifacts/native/case.svg', '.cache/file', 'node_modules/.pnpm-store/cache',
    `${studio}/dist/index.html`, `${studio}/.vinext/state`, `${studio}/tsconfig.tsbuildinfo`,
    `${studio}/.sites-runtime/pnpm-store/package`, `${studio}/.sites-runtime/wrangler/logs/log.txt`];
  try {
    mkdirSync(dirname(script), { recursive: true });
    copyFileSync(new URL('../scripts/clean.mjs', import.meta.url), script);
    for (const path of [...keep, ...remove]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), 'fixture');
    }
    const run = () => spawnSync(process.execPath, [script], { cwd: temporary, encoding: 'utf8' });
    assert.equal(run().status, 0);
    for (const path of remove) assert(!existsSync(join(root, path)), path);
    for (const path of keep) assert(existsSync(join(root, path)), path);
    assert.equal(run().status, 0, 'Cleanup is repeatable');

    const outside = join(temporary, 'outside');
    mkdirSync(join(outside, 'pnpm-store'), { recursive: true });
    writeFileSync(join(outside, 'pnpm-store/keep'), 'fixture');
    rmSync(join(root, studio, '.sites-runtime'), { recursive: true });
    symlinkSync(outside, join(root, studio, '.sites-runtime'));
    const blocked = run();
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /Refusing cleanup through symlink/);
    assert(existsSync(join(outside, 'pnpm-store/keep')));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
