import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));

// Every native reference uses these settings so references and probe output stay comparable.
export const nativeArgs = ['--layout=tala', '--tala-seeds=1', '--theme=0', '--dark-theme=-1', '--pad=0', '--scale=1', '--sketch=false', '--center=false', '--bundle=true', '--force-appendix=false', '--animate-interval=0', '--target=*', '--timeout=30'];

export function examples(full = false) {
  const cases = JSON.parse(readFileSync(join(root, 'examples/cases.json'), 'utf8'));
  if (!full) return cases;
  for (const path of [...globSync(['files/*.d2', 'archives/*/*.d2'], { cwd: join(root, 'examples') })].sort()) {
    cases.push({ id: path.replace(/^archives\//, '').slice(0, -3), directory: 'examples', runs: [{ id: 'tala', entry: path }] });
  }
  return cases;
}

export function pathData(commands) {
  return commands.map(command => {
    if (command.Kind === 0) return `M${command.P1.X} ${command.P1.Y}`;
    if (command.Kind === 1) return `L${command.P1.X} ${command.P1.Y}`;
    if (command.Kind === 5) return 'Z';
    throw new Error(`Unsupported scene path command ${command.Kind}`);
  }).join(' ');
}

export const goEnv = { ...process.env, GOCACHE: join(root, '.cache/go-build'), GOMODCACHE: join(root, '.cache/go-mod') };

// Runs inside the pinned D2 source so probes resolve its Go module.
// The Go wasm runtime refuses to start when argv plus environment exceed 8 KiB, and a long shell environment (editor and agent variables) can
// reach that, so a wasm run gets only the variables its node launcher needs.
const WASM_ENV = ['PATH', 'HOME', 'TMPDIR', 'GOROOT', 'LANG'];
const wasmEnv = env => Object.fromEntries(WASM_ENV.filter(k => env[k] !== undefined).map(k => [k, env[k]]));

export function goRun(command, args, options = {}) {
  const merged = { cwd: join(root, 'imports/d2'), env: goEnv, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024, ...options };
  const result = spawnSync(command, args, command.endsWith('go_js_wasm_exec') ? { ...merged, env: wasmEnv(merged.env) } : merged);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

// Builds a Go probe to `binary` and, unless disabled, `${binary}.wasm`; returns runners for each.
export function goProbe(source, binary, wasm = true) {
  goRun('go', ['build', '-mod=readonly', '-o', binary, source]);
  const probe = { native: args => goRun(binary, args) };
  if (!wasm) return probe;
  goRun('go', ['build', '-mod=readonly', '-o', `${binary}.wasm`, source], { env: { ...goEnv, GOOS: 'js', GOARCH: 'wasm' } });
  probe.goRoot = goRun('go', ['env', 'GOROOT']).trim();
  // A js/wasm run takes ~1-3s but about 1 in 20-50 hangs forever under parallel load (reproduced with plain
  // concurrent runs, independent of stdin and memory). Fail fast and retry hangs; a deterministic hang still fails.
  probe.wasm = args => {
    for (let attempt = 1; ; attempt++) {
      try {
        return goRun(join(probe.goRoot, 'lib/wasm/go_js_wasm_exec'), [`${binary}.wasm`, ...args], { timeout: 30_000 });
      } catch (error) {
        if (attempt === 3 || error.actual?.code !== 'ETIMEDOUT') throw error;
      }
    }
  };
  return probe;
}
