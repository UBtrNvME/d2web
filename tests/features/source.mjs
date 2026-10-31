import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../examples.mjs';

const read = path => readFileSync(join(root, 'imports/d2', path), 'utf8');

function values(source, pattern, label) {
  const found = [...source.matchAll(pattern)].map(match => match[1]);
  if (found.length === 0) throw new Error(`No entries parsed from ${label}`);
  return found;
}

function slice(source, name) {
  return source.match(new RegExp(`\\b${name}\\s*=\\s*\\[\\s*\\]\\s*string\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

export function expectedIds() {
  const ids = new Set();
  const add = (prefix, entries) => entries.forEach(value => ids.add(`${prefix}:${value}`));
  const keywords = read('d2ast/keywords.go');
  for (const [name, prefix] of [
    ['SimpleReservedKeywords', 'keyword'], ['CompositeReservedKeywords', 'keyword'], ['ReservedKeywordHolders', 'keyword'],
    ['BoardKeywords', 'board'], ['StyleKeywords', 'style'],
  ]) {
    const body = keywords.match(new RegExp(`\\b${name}\\s*=\\s*map\\s*\\[\\s*string\\s*\\]\\s*struct\\s*\\{\\s*\\}\\s*\\{([\\s\\S]*?)^\\s*\\}`, 'm'))?.[1] ?? '';
    add(prefix, values(body, /"([^"\n]+)"\s*:\s*\{\s*\}/g, name));
  }
  for (const [name, prefix] of [
    ['NearConstantsArray', 'near'], ['LabelPositionsArray', 'labelpos'], ['TooltipPositionsArray', 'tooltippos'],
    ['FillPatterns', 'pattern'], ['TextTransforms', 'transform'],
  ]) {
    add(prefix, values(slice(keywords, name), /"([^"\n]+)"/g, name));
  }

  const target = read('d2target/d2target.go');
  const shapes = new Map([...target.matchAll(/\b(Shape\w+)\s*=\s*"([^"\n]+)"/g)].map(([, name, value]) => [name, value]));
  add('shape', values(slice(target, 'Shapes'), /\b(Shape\w+)\b/g, 'Shapes').map(name => {
    if (!shapes.has(name)) throw new Error(`No string constant found for ${name}`);
    return shapes.get(name);
  }));
  add('arrow', values(target, /\bArrowhead\s*=\s*"([^"\n]+)"/g, 'Arrowhead constants'));

  const themes = 'd2themes/d2themescatalog';
  const themeFiles = readdirSync(join(root, 'imports/d2', themes)).filter(file => file.endsWith('.go') && file !== 'catalog.go').sort();
  if (themeFiles.length === 0) throw new Error(`No theme files found in ${themes}`);
  for (const file of themeFiles) add('theme', values(read(`${themes}/${file}`), /\bID:\s*(\d+),/g, `${themes}/${file}`));

  add('config', values(read('d2compiler/compile.go'), /\bconfigMap\s*\.\s*GetField\s*\(\s*d2ast\s*\.\s*FlatUnquotedString\s*\(\s*"([^"\n]+)"\s*\)\s*\)/g, 'configMap.GetField'));
  add('layout', ['dagre', 'elk', 'tala']);
  return ids;
}
