import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { ensureSyntaxTree, HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import table from './keywords.json' with { type: 'json' };

const keywords = new Set(['style', 'language', ...table.keywords.map(k => k.name)]);
const languageOptions = table.languages.map(label => ({
  label, type: 'type', boost: table.commonLanguages.includes(label) ? 100 - table.commonLanguages.indexOf(label) : 0,
}));

export const d2Language = StreamLanguage.define({
  name: 'D2',
  startState: () => ({ quote: '', block: '', value: false }),
  mergeTokens: false,
  token(stream, state) {
    if (state.block) {
      while (!stream.eol()) {
        if (stream.match(state.block)) { state.block = ''; break; }
        if (stream.next() === '\\') stream.next();
      }
      return 'string';
    }
    if (stream.sol()) state.value = false;
    if (!state.quote && stream.eatSpace()) return null;
    if (state.quote || stream.peek() === '"' || stream.peek() === "'") {
      if (!state.quote) state.quote = stream.next() as string;
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\') stream.next();
        else if (ch === state.quote) { state.quote = ''; break; }
      }
      state.value = false;
      return 'string';
    }
    if (stream.peek() === '#') { stream.skipToEnd(); return 'comment'; }
    if (stream.match(/^(?:<->|->|<-|--)/)) return 'operator';
    if (stream.match(/^\|+/)) {
      state.block = stream.current();
      stream.match(/^[^\s|]*/);
      state.value = false;
      return 'meta';
    }
    if (stream.match(/^[:{}.;\[\]]/)) {
      state.value = stream.current() === ':';
      return 'punctuation';
    }
    state.value = false;
    if (stream.match(/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?(?=$|[\s;}])/i)) return 'number';
    if (stream.match(/^(?:[\p{L}\p{N}_$]|-(?![->]))+/u)) return keywords.has(stream.current()) ? 'keyword' : 'variableName';
    // Escaped punctuation belongs to the identifier, not to the surrounding map.
    if (stream.next() === '\\') stream.next();
    return 'variableName';
  },
  languageData: { commentTokens: { line: '#' } },
});

type Token = { from: number; to: number; name: string; text: string };
const pathOf = (tokens: Token[]) => {
  const end = tokens.findIndex(t => t.text === ':');
  return tokens.slice(0, end < 0 ? tokens.length : end).filter(t => t.text !== '.').map(t => t.text);
};

export function d2Completion(context: CompletionContext) {
  const { state, pos } = context, doc = state.doc;
  const tree = ensureSyntaxTree(state, doc.length, 50);
  if (!tree) return null;
  const tokens: Token[] = [];
  tree.iterate({ enter(node) {
    if (node.type.isTop) return;
    tokens.push({ from: node.from, to: node.to, name: node.name, text: doc.sliceString(node.from, node.to) });
  } });
  const at = tokens.find(t => t.from < pos && t.to >= pos);
  if (at?.name === 'comment' || at?.name === 'string') return null;
  if (at?.name === 'meta') {
    const tag = /^\|+([^\s|]*)$/.exec(doc.sliceString(at.from, pos));
    return tag ? { from: pos - tag[1].length, options: languageOptions } : null;
  }

  // Read lexical maps only: no compiler model, and comments/strings cannot introduce braces or properties.
  const shapes = new Map<string, string>(), scopes: string[][] = [[]];
  let statement: Token[] = [], previous = 0;
  let current: { scope: string[]; statement: Token[] } | undefined;
  const capture = () => { current = { scope: scopes.at(-1)!, statement: [...statement] }; };
  for (const token of tokens) {
    if (!current && token.from >= pos) {
      if (doc.sliceString(previous, pos).includes('\n')) statement = [];
      capture();
    }
    if (doc.sliceString(previous, token.from).includes('\n')) statement = [];
    previous = token.to;
    if (token.name === 'comment') continue;
    const scope = scopes.at(-1)!;
    if (statement.at(-1)?.text === ':') {
      const key = pathOf(statement), value = token.name === 'string' ? token.text.slice(1, -1) : token.text;
      if (key.at(-1) === 'shape' && table.shapes.includes(value)) shapes.set(JSON.stringify([...scope, ...key.slice(0, -1)]), value);
    }
    if (token.name === 'string' || token.name === 'meta') statement.push(token);
    else if (token.text === '{') { scopes.push([...scope, ...pathOf(statement)]); statement = []; }
    else if (token.text === '}') { if (scopes.length > 1) scopes.pop(); statement = []; }
    else if (token.text === ';') statement = [];
    else statement.push(token);
    if (!current && token.to >= pos) capture();
  }
  if (!current) {
    if (doc.sliceString(previous, pos).includes('\n')) statement = [];
    capture();
  }
  const here = current!, colon = here.statement.findIndex(t => t.text === ':');
  const path = [...here.scope, ...pathOf(here.statement)];
  if (colon >= 0) {
    const start = here.statement[colon].to;
    const value = doc.sliceString(start, pos), from = start + (value.match(/^\s*/)?.[0].length ?? 0);
    const keyword = path.at(-1);
    let values: string[];
    if (keyword === 'shape') values = path.some(p => p === 'source-arrowhead' || p === 'target-arrowhead') ? table.arrowheads : table.shapes;
    else if (keyword === 'language') return { from, options: languageOptions };
    else if (table.keywords.some(k => k.name === keyword && k.domain.kind === 'boolean')) values = [true, false].map(String);
    else return null;
    return { from, options: values.map(label => ({ label, type: 'keyword' })) };
  }
  const style = path.lastIndexOf('style');
  if (style < 0 || style < path.length - 2) return null;
  const styleToken = here.statement.find(t => t.text === 'style');
  if (style >= here.scope.length && !here.statement.some(t => t.text === '.' && t.from > styleToken!.from)) return null;
  const shape = shapes.get(JSON.stringify(path.slice(0, style)));
  const word = context.matchBefore(/[\w-]*$/)!;
  return {
    from: word.from,
    options: table.keywords.filter(k => k.style && (!shape || !('only' in k) || k.only?.includes(shape))).map(k => ({ label: k.name, type: 'property' })),
  };
}

export const sourceLanguage = [
  d2Language,
  syntaxHighlighting(HighlightStyle.define([
    { tag: tags.comment, class: 'd2-comment' },
    { tag: tags.string, class: 'd2-string' },
    { tag: tags.keyword, class: 'd2-keyword' },
    { tag: tags.operator, class: 'd2-arrow' },
    { tag: tags.punctuation, class: 'd2-punctuation' },
    { tag: tags.number, class: 'd2-number' },
    { tag: tags.meta, class: 'd2-tag' },
  ])),
  autocompletion({ override: [d2Completion] }),
];
