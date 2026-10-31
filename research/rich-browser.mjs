import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { goProbe, root } from '../tests/examples.mjs';

// Exports the scene text runs, fonts and native SVG consumed by research/browser/rich.spec.mjs.
const output = join(root, 'artifacts/research-rich');
mkdirSync(output, { recursive: true });
const fonts = join(output, 'fonts');
mkdirSync(fonts, { recursive: true });
const probe = goProbe(join(root, 'research/rich.go'), join(output, 'probe'));
// unicode is exported with the CLI-style host/bundled fallback resolver; the output depends on this machine's fonts.
for (const name of ['markdown', 'code', 'unicode']) {
  const report = JSON.parse(probe.native([join(root, 'examples/research/rich', name + '.d2'), '--export', `--fonts-dir=${fonts}`, ...(name === 'unicode' ? ['--fallback'] : [])]));
  if (report.error) throw new Error(`${name}: ${report.error}`);
  writeFileSync(join(output, `${name}.export.json`), JSON.stringify(report) + '\n');
}
