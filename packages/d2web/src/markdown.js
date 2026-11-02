const esc = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// shortcut: a deliberately closed subset, not CommonMark; reject the whole object when syntax needs a fuller parser.
export function renderMarkdown(source, hrefOf) {
  const links = [];
  function inline(text, inLink = false, depth = 0) {
    if (depth > 8) return null;
    let out = '';
    for (let i = 0; i < text.length;) {
      const rest = text.slice(i);
      if (rest[0] === '`') {
        const m = rest.match(/^`([^`\n]+)`(?!`)/);
        if (!m || /^\s|\s$/.test(m[1])) return null;
        out += `<code>${esc(m[1].replace(/[ \t]+/g, ' '))}</code>`; i += m[0].length;
      } else if (rest[0] === '*' || rest[0] === '_' || rest.startsWith('~~')) {
        const c = rest[0], mark = rest.startsWith(c + c) ? c + c : c, end = rest.indexOf(mark, mark.length);
        if (c === '~' && mark === '~') return null;
        if (end <= mark.length || /^\s|\s$/.test(rest.slice(mark.length, end)) || rest[end + mark.length] === c) return null;
        if (/[\p{L}\p{N}]/u.test(text[i - 1] ?? '') || /[\p{L}\p{N}]/u.test(rest[end + mark.length] ?? '')) return null;
        const body = inline(rest.slice(mark.length, end), inLink, depth + 1);
        if (body === null || /<(?:strong|em|code|del)>/.test(body)) return null;
        const tag = c === '~' ? 'del' : mark.length === 2 ? 'strong' : 'em';
        out += `<${tag}>${body}</${tag}>`; i += end + mark.length;
      } else if (rest[0] === '[') {
        const m = rest.match(/^\[([^\[\]\n]+)\]\(([^\s()<>"\\]+)\)/);
        if (!m || inLink || /&|['`]/.test(m[2])) return null;
        const body = inline(m[1], true, depth + 1);
        if (body === null) return null;
        links.push(m[2]);
        const href = hrefOf(m[2]);
        out += `<a${href ? ` href="${esc(href)}"` : ''}>${body}</a>`; i += m[0].length;
      } else {
        const m = rest.match(/^[^*`[\]\\_~<>!&|]+/);
        if (!m) return null;
        out += esc(m[0]); i += m[0].length;
      }
    }
    return out;
  }
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const special = line => /^(?:#{1,6}(?: |$)|[-+*](?: |$)|\d{1,9}\. |> |---$|```)/.test(line);
  let html = '';
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { i++; continue; }
    if (/^[ \t]|[ \t]{2,}$|\t$/.test(lines[i])) return null;
    const line = lines[i], heading = line.match(/^(#{1,6}) (.+)$/), list = line.match(/^(-|\d{1,9}\.) (.+)$/);
    let tag, text;
    if (line.startsWith('```')) {
      if (!/^```[\w-]*$/.test(line)) return null;
      const start = ++i;
      while (i < lines.length && lines[i] !== '```') {
        if (/^ {0,3}`{3,}[ \t]*$/.test(lines[i])) return null;
        i++;
      }
      if (i === lines.length) return null;
      html += `<pre><code>${esc(lines.slice(start, i).join('\n') + (i > start ? '\n' : ''))}</code></pre>`; i++; continue;
    } else if (heading) {
      tag = `h${heading[1].length}`; text = heading[2].replace(/[ \t]+#+[ \t]*$/, ''); i++;
    } else if (line === '---') {
      html += '<hr>'; i++; continue;
    } else if (list) {
      const ordered = list[1] !== '-', items = [], pattern = ordered ? /^\d{1,9}\. (.+)$/ : /^- (.+)$/;
      while (i < lines.length && pattern.test(lines[i])) {
        const text = lines[i++].match(pattern)[1], body = inline(text);
        if (body === null || special(text) || /^[ \t]|[ \t]{2,}$|\t$|^\[[ xX]\] /.test(text)) return null;
        items.push(`<li>${body}</li>`);
      }
      // Lazy continuations, nesting and loose lists have different block semantics.
      let next = i; while (next < lines.length && !lines[next].trim()) next++;
      if ((lines[i]?.trim() && !special(lines[i])) || (next > i && pattern.test(lines[next] ?? ''))) return null;
      const tag = ordered ? 'ol' : 'ul', start = ordered && parseInt(list[1]) !== 1 ? ` start="${parseInt(list[1])}"` : '';
      html += `<${tag}${start}>${items.join('')}</${tag}>`; continue;
    } else if (line.startsWith('> ')) {
      const quote = [];
      while (lines[i]?.startsWith('> ')) {
        const text = lines[i++].slice(2);
        if (!text || special(text) || /^[ \t]|[ \t]{2,}$|\t$/.test(text)) return null;
        quote.push(text);
      }
      if (lines[i]?.trim() && !special(lines[i])) return null;
      tag = 'blockquote'; text = quote.join('\n');
    } else {
      const paragraph = [line]; i++;
      while (i < lines.length && lines[i].trim() && !special(lines[i])) paragraph.push(lines[i++]);
      if (paragraph.some(s => /^[ \t]|[ \t]{2,}$|\t$|^(?:#|>|[-+*](?: |\t)|\d+\.\t|[=~-]+$)/.test(s)) || lines[i] === '---' || /^\d+\. /.test(lines[i] ?? '') && !lines[i].startsWith('1. ')) return null;
      tag = 'p'; text = paragraph.join('\n');
    }
    const body = inline(text);
    if (body === null) return null;
    html += tag === 'blockquote' ? `<blockquote><p>${body}</p></blockquote>` : `<${tag}>${body}</${tag}>`;
  }
  return html ? { html, links } : null;
}

// D2 v0.9.0 github-markdown.css and lib/textmeasure/markdown.go (metrics, including collapsed first/last margins).
export const markdownCSS = `
[data-flow-markdown]{display:flow-root;margin:0;font-family:var(--md-regular);font-size:16px;line-height:1.5;overflow-wrap:break-word;tab-size:4;font-synthesis:none}
[data-flow-markdown] *{box-sizing:content-box}
[data-flow-markdown] :is(p,blockquote,ul,ol,pre){margin:0 0 16px}
[data-flow-markdown] :is(h1,h2,h3,h4,h5,h6){margin:24px 0 16px;font-weight:400;line-height:1.25;font-family:var(--md-semibold)}
[data-flow-markdown] h1{font-size:2em}
[data-flow-markdown] h2{font-size:1.5em}
[data-flow-markdown] :is(h1,h2){padding-bottom:.3em;border-bottom:1px solid var(--md-border-muted,currentColor)}
[data-flow-markdown] h3{font-size:1.25em}
[data-flow-markdown] h4{font-size:1em}
[data-flow-markdown] h5{font-size:.875em}
[data-flow-markdown] h6{font-size:.85em;color:var(--md-muted,inherit)}
[data-flow-markdown] strong{font-family:var(--md-bold);font-weight:inherit}
[data-flow-markdown] em{font-family:var(--md-italic);font-style:normal}
[data-flow-markdown] del{text-decoration:line-through}
[data-flow-markdown] a{color:var(--md-accent,inherit);text-decoration:none}
[data-flow-markdown] a:hover{text-decoration:underline}
[data-flow-markdown] a:not([href]){color:inherit}
[data-flow-markdown] :is(ul,ol){padding-left:2em}
[data-flow-markdown] li+li{margin-top:.25em}
[data-flow-markdown] blockquote{padding:0 1em;color:var(--md-muted,inherit);border-left:.25em solid var(--md-border,currentColor)}
[data-flow-markdown] hr{box-sizing:content-box;height:.25em;padding:0;margin:24px 0;border:0;background:var(--md-border,currentColor)}
[data-flow-markdown] :is(pre,code){font-family:var(--md-mono)}
[data-flow-markdown] code{padding:.2em .4em;margin:0;font-size:85%;background:var(--md-code,transparent);border-radius:6px}
[data-flow-markdown] :is(h1,h2,h3,h4,h5,h6) code{padding:0 .2em;font-size:inherit}
[data-flow-markdown] pre{padding:16px;font-size:85%;line-height:1.45;white-space:pre;overflow:visible;overflow-wrap:normal;background:var(--md-code,transparent);border-radius:6px}
[data-flow-markdown] pre>code{padding:0;margin:0;font-size:100%;line-height:inherit;white-space:pre;background:transparent;border:0}
[data-flow-markdown]>:first-child,[data-flow-markdown] blockquote>:first-child{margin-top:0}
[data-flow-markdown]>:last-child,[data-flow-markdown] blockquote>:last-child{margin-bottom:0}
`;
