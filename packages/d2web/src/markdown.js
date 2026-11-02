const esc = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const entities = { amp: '&', lt: '<', gt: '>', quot: '"' };
const decode = text => text.replace(/&(?:#(\d+)|([a-z]+));/g, (m, code, name) => code ? String.fromCodePoint(+code) : entities[name] ?? m);

// The association `html` is D2's markdown document (goldmark, as D2 lays it out), serialised by the worker with only D2's elements and the
// attributes D2 reads, `href` first. The page adds one thing: its link policy, so an unsafe destination keeps its text but loses `href`.
// The page re-checks the shape it relies on (defence in depth if the worker's output were ever other than that): every `<` opens one of D2's
// elements with only its allowed attributes, double-quoted, once each and in the worker's order (Go's serialiser escapes `<`, `>` and `"`
// everywhere else), so the `href` below is the anchor's only one. Anything else stays positioned.
const value = '="[^"<>]*"';
const d2Tag = new RegExp(`</(?:p|h[1-6]|blockquote|ul|ol|li|pre|code|em|b|strong|del|s|strike|a|table|thead|tbody|tfoot|tr|td|th)>|<(?:p|h[1-6]|blockquote|ul|li|pre|code|em|b|strong|del|s|strike|table|thead|tbody|tfoot|tr|br/|hr/)>|<a(?: href${value})?(?: title${value})?>|<ol(?: start${value})?(?: type${value})?>|<t[hd](?: align${value})?>`, 'g');

export function renderMarkdown(html, hrefOf) {
  if (!html || html.replace(d2Tag, '').includes('<')) return null;
  const links = [];
  const out = html.replace(/<a href="([^"]*)"/g, (_, raw) => {
    const url = decode(raw), href = hrefOf(url);
    links.push(url);
    return href ? `<a href="${esc(href)}"` : '<a';
  });
  return { html: out, links };
}

// D2 v0.9.0 github-markdown.css and lib/textmeasure/markdown.go (metrics, including collapsed first/last margins). Tables follow D2's own
// layout (markdown_svg.go markdownTableCellContext): line height 1.25, semibold centred headers, 6x13 px cell padding.
export const markdownCSS = `
[data-flow-markdown]{display:flow-root;margin:0;font-family:var(--md-regular);font-size:16px;line-height:1.5;overflow-wrap:break-word;tab-size:4;font-synthesis:none}
[data-flow-markdown] *{box-sizing:content-box}
[data-flow-markdown] :is(p,blockquote,ul,ol,pre,table){margin:0 0 16px}
[data-flow-markdown] :is(h1,h2,h3,h4,h5,h6){margin:24px 0 16px;font-weight:400;line-height:1.25;font-family:var(--md-semibold)}
[data-flow-markdown] h1{font-size:2em}
[data-flow-markdown] h2{font-size:1.5em}
[data-flow-markdown] :is(h1,h2){padding-bottom:.3em;border-bottom:1px solid var(--md-border-muted,currentColor)}
[data-flow-markdown] h3{font-size:1.25em}
[data-flow-markdown] h4{font-size:1em}
[data-flow-markdown] h5{font-size:.875em}
[data-flow-markdown] h6{font-size:.85em;color:var(--md-muted,inherit)}
[data-flow-markdown] em{font-family:var(--md-italic);font-style:normal}
[data-flow-markdown] del{text-decoration:line-through}
[data-flow-markdown] a{color:var(--md-accent,inherit);text-decoration:none}
[data-flow-markdown] a:hover{text-decoration:underline}
[data-flow-markdown] a:not([href]){color:inherit}
[data-flow-markdown] :is(ul,ol){padding-left:2em}
[data-flow-markdown] li+li{margin-top:.25em}
[data-flow-markdown] li>p{margin-top:16px}
[data-flow-markdown] :is(ul,ol) :is(ul,ol){margin-top:0;margin-bottom:0}
[data-flow-markdown] :is(ol,ul) ol{list-style-type:lower-roman}
[data-flow-markdown] :is(ol,ul) :is(ol,ul) ol{list-style-type:lower-alpha}
[data-flow-markdown] ol[type="1"]{list-style-type:decimal}
[data-flow-markdown] ol[type=a]{list-style-type:lower-alpha}
[data-flow-markdown] ol[type=i]{list-style-type:lower-roman}
[data-flow-markdown] :is(b,strong){font-family:var(--md-bold);font-weight:inherit}
[data-flow-markdown] th{font-family:var(--md-semibold);font-weight:inherit;text-align:center}
[data-flow-markdown] :is(s,strike){text-decoration:line-through}
[data-flow-markdown] table{display:block;width:max-content;max-width:100%;border-spacing:0;border-collapse:collapse;line-height:1.25;background:var(--md-table)}
[data-flow-markdown] :is(th,td){padding:6px 13px;border:1px solid var(--md-table-border)}
[data-flow-markdown] th[align=left],[data-flow-markdown] td[align=left]{text-align:left}
[data-flow-markdown] th[align=center],[data-flow-markdown] td[align=center]{text-align:center}
[data-flow-markdown] th[align=right],[data-flow-markdown] td[align=right]{text-align:right}
[data-flow-markdown] tr:nth-child(2n){background:var(--md-table-stripe)}
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
