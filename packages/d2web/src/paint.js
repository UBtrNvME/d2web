// Painter: turns the scene JSON of spec 0001 (packages/d2web-wasm/scenejson) into SVG or HTML-first markup. It covers every primitive,
// paint, clip, mask, filter and blend kind in the corpus; the native DOM renderer attaches the returned animation specifications.
import { animationSpecs } from './animation.js';
import { primBounds, subtreeBounds, linkOwners } from './geometry.ts';
import { renderMarkdown, markdownCSS } from './markdown.js';

const ALIGN = ['none', 'xMinYMin', 'xMidYMin', 'xMaxYMin', 'xMinYMid', 'xMidYMid', 'xMaxYMid', 'xMinYMax', 'xMidYMax', 'xMaxYMax'];
const BLEND = ['normal', 'multiply', 'darken', 'color-burn', 'overlay', 'lighten'];
const CAP = ['butt', 'round', 'square'];
const JOIN = ['miter', 'round', 'bevel'];
const SPREAD = ['pad', 'reflect', 'repeat'];
// A D2 link is author text. A scheme that runs script in the page (javascript:, vbscript:) or loads a document (data:) is never put in `href`; the anchor keeps its
// name and tooltip. The URL parser strips the whitespace and control characters browsers ignore, so `java\tscript:` is caught as well.
// shortcut: a denylist of three schemes, not an allowlist, so mailto:, tel: and relative links keep working; tighten if consumers need an allowlist.
const hrefOf = url => { try { return ['javascript:', 'vbscript:', 'data:'].includes(new URL(url, 'https://base.invalid/').protocol) ? '' : url; } catch { return url; } };
const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const num = n => +n.toFixed(5);
const matrix = m => `matrix(${[m.A, m.B, m.C, m.D, m.E, m.F].map(num).join(' ')})`;
const isIdentity = m => m.A === 1 && m.B === 0 && m.C === 0 && m.D === 1 && m.E === 0 && m.F === 0;
// A color string is rgba(r,g,b,a); SVG wants the alpha as a separate opacity attribute.
const split = c => { const [r, g, b, a] = c.slice(5, -1).split(','); return [`rgb(${r},${g},${b})`, +a]; };

export const fontFamily = id => 'scene-' + id.replace(/\W/g, '-');
// Spec 0007: a run's primary font, then the consumer fallbacks D2 chose for glyphs the primary lacks, as one CSS font stack.
const fontStack = p => [p.Font.Asset, ...(p.Fallbacks ?? [])].map(fontFamily).join(',');

export function paintScene(scene, { html = false, cssMasks = false, idPrefix = '', a11y = false, association = [], flow = false } = {}) {
  if (!scene?.Root || !scene.ViewBox) throw new Error('scene needs Root and ViewBox');
  // Mask and filter regions cover the document with a margin; huge regions make Chromium drop content on large boards.
  const region = (({ X, Y, Width, Height }) => `x="${X - 1000}" y="${Y - 1000}" width="${Width + 2000}" height="${Height + 2000}"`)(scene.ViewBox);
  let ids = 0;
  const animations = []; // per animated node, in document order: the specs for `data-d2-anim="<index>"` (spec 0005)
  let inEffect = false;
  const stats = {};
  const v = scene.ViewBox;
  const count = key => { stats[key] = (stats[key] ?? 0) + 1; };
  const defs = [];
  const next = prefix => `${idPrefix}${prefix}${++ids}`;

  // Spec 0010 2.3: an image D2 could not carry (link mode, or a link the page did not supply) is a placeholder in the scene; the association names its link
  // and node. Only http, https and image data URLs become an element (the link-safety rule of ADR 0009); anything else, including relative paths, stays D2's placeholder.
  const imageLinks = new Map(association.filter(o => o.image?.node && o.image.source).map(o => [o.image.node, o.image.source]));
  const linkedImage = (p, id) => {
    if (p.Asset !== 'image:unavailable' || !imageLinks.has(id)) return '';
    try { const u = new URL(imageLinks.get(id)); return u.protocol === 'http:' || u.protocol === 'https:' || (u.protocol === 'data:' && /^data:image\//i.test(u.href)) ? u.href : ''; } catch { return ''; }
  };

  const stops = list => list.map(s => { const [c, a] = split(s.Color); return `<stop offset="${num(s.Offset)}" stop-color="${c}" stop-opacity="${a}"/>`; }).join('');
  const units = u => (u === 1 ? 'userSpaceOnUse' : 'objectBoundingBox');
  const gradientAttrs = p => `gradientUnits="${units(p.Units)}"${isIdentity(p.Transform) ? '' : ` gradientTransform="${matrix(p.Transform)}"`} spreadMethod="${SPREAD[p.Spread]}"`;

  // Returns [value, opacity] for a fill or stroke attribute; null means none.
  function paint(p) {
    if (!p) return ['none', 1];
    if (p.$ === 'SolidPaint') return split(p.Color);
    const id = next('paint');
    if (p.$ === 'LinearGradient') defs.push(`<linearGradient id="${id}" x1="${num(p.Start.X)}" y1="${num(p.Start.Y)}" x2="${num(p.End.X)}" y2="${num(p.End.Y)}" ${gradientAttrs(p)}>${stops(p.Stops)}</linearGradient>`);
    else if (p.$ === 'RadialGradient') defs.push(`<radialGradient id="${id}" cx="${num(p.Center.X)}" cy="${num(p.Center.Y)}" r="${num(p.Radius)}" fx="${num(p.Focal.X)}" fy="${num(p.Focal.Y)}" fr="${num(p.FocalRadius)}" ${gradientAttrs(p)}>${stops(p.Stops)}</radialGradient>`);
    else if (p.$ === 'PatternPaint') defs.push(`<pattern id="${id}" x="${num(p.Tile.X)}" y="${num(p.Tile.Y)}" width="${num(p.Tile.Width)}" height="${num(p.Tile.Height)}" patternUnits="${units(p.Units)}"${isIdentity(p.Transform) ? '' : ` patternTransform="${matrix(p.Transform)}"`}>${node(p.Root)}</pattern>`);
    else throw new Error(`unknown paint ${p.$}`);
    return [`url(#${id})`, 1];
  }
  const fillAttrs = p => { const [v, a] = paint(p); return `fill="${v}"${a === 1 ? '' : ` fill-opacity="${num(a)}"`}`; };
  function strokeAttrs(s) {
    if (!s || !s.Paint || !(s.Width > 0)) return 'stroke="none"';
    const [v, a] = paint(s.Paint);
    return `stroke="${v}"${a === 1 ? '' : ` stroke-opacity="${num(a)}"`} stroke-width="${num(s.Width)}" stroke-linecap="${CAP[s.Cap]}" stroke-linejoin="${JOIN[s.Join]}"${s.MiterLimit > 0 ? ` stroke-miterlimit="${num(s.MiterLimit)}"` : ''}${s.Dashes?.length ? ` stroke-dasharray="${s.Dashes.map(num).join(' ')}"` : ''}${s.DashOffset ? ` stroke-dashoffset="${num(s.DashOffset)}"` : ''}`;
  }

  function pathData(commands) {
    return commands.map(c => {
      const p = (...pts) => pts.map(q => `${num(q.X)} ${num(q.Y)}`).join(' ');
      switch (c.Kind) {
        case 0: return `M${p(c.P1)}`;
        case 1: return `L${p(c.P1)}`;
        case 2: return `Q${p(c.P1, c.P2)}`;
        case 3: return `C${p(c.P1, c.P2, c.P3)}`;
        case 4: return `A${num(c.RadiusX)} ${num(c.RadiusY)} ${num(c.Rotation * 180 / Math.PI)} ${+c.LargeArc} ${+c.Sweep} ${p(c.P1)}`;
        case 5: return 'Z';
        default: throw new Error(`unknown path command ${c.Kind}`);
      }
    }).join(' ');
  }

  function primitive(p, id) {
    if (!p) return '';
    if (inEffect) count(`svg:in-effect:${p.$}`);
    switch (p.$) {
      case 'Rect': return `<rect x="${num(p.Box.X)}" y="${num(p.Box.Y)}" width="${num(p.Box.Width)}" height="${num(p.Box.Height)}"${p.RadiusX ? ` rx="${num(p.RadiusX)}"` : ''}${p.RadiusY ? ` ry="${num(p.RadiusY)}"` : ''} ${fillAttrs(p.Fill)} ${strokeAttrs(p.Stroke)}/>`;
      case 'Ellipse': return `<ellipse cx="${num(p.Center.X)}" cy="${num(p.Center.Y)}" rx="${num(p.RadiusX)}" ry="${num(p.RadiusY)}" ${fillAttrs(p.Fill)} ${strokeAttrs(p.Stroke)}/>`;
      case 'Path': return `<path d="${pathData(p.Commands)}" fill-rule="${p.FillRule ? 'evenodd' : 'nonzero'}" ${fillAttrs(p.Fill)} ${strokeAttrs(p.Stroke)}/>`;
      case 'TextRun': {
        const decoration = [p.Underline && 'underline', p.Strike && 'line-through'].filter(Boolean).join(' ');
        return `<text x="${num(p.Origin.X)}" y="${num(p.Origin.Y)}" font-family="${fontStack(p)}" font-size="${num(p.Font.Size)}" text-anchor="${['start', 'middle', 'end'][p.Anchor]}"${decoration ? ` text-decoration="${decoration}"` : ''} xml:space="preserve" ${fillAttrs(p.Fill)} ${strokeAttrs(p.Stroke)}>${esc(p.Text)}</text>`;
      }
      case 'Image': {
        const asset = scene.Assets[p.Asset];
        const fit = `${ALIGN[p.Aspect.Align]}${p.Aspect.Align ? (p.Aspect.Fit ? ' slice' : ' meet') : ''}`;
        const box = `x="${num(p.Box.X)}" y="${num(p.Box.Y)}" width="${num(p.Box.Width)}" height="${num(p.Box.Height)}"`;
        const link = linkedImage(p, id);
        if (link) return `<image ${box} preserveAspectRatio="${fit}" href="${esc(link)}" referrerpolicy="no-referrer"/>`;
        if (asset.$ === 'RasterAsset') return `<image ${box} preserveAspectRatio="${fit}" href="data:${asset.MIMEType};base64,${asset.Data}"/>`;
        if (asset.$ === 'VectorAsset') return `<svg ${box} viewBox="${[asset.ViewBox.X, asset.ViewBox.Y, asset.ViewBox.Width, asset.ViewBox.Height].map(num).join(' ')}" preserveAspectRatio="${fit}" overflow="hidden">${node(asset.Root)}</svg>`;
        throw new Error(`image asset ${asset.$}`);
      }
      default: throw new Error(`unknown primitive ${p.$}`);
    }
  }

  function filterDef(filters) {
    const id = next('filter');
    const parts = filters.map(f => {
      if (f.$ === 'GaussianBlur') return `<feGaussianBlur stdDeviation="${num(f.SigmaX)} ${num(f.SigmaY)}"/>`;
      if (f.$ === 'DropShadow') { const [c, a] = split(f.Color); return `<feDropShadow dx="${num(f.OffsetX)}" dy="${num(f.OffsetY)}" stdDeviation="${num(f.SigmaX)} ${num(f.SigmaY)}" flood-color="${c}" flood-opacity="${a}"/>`; }
      throw new Error(`unknown filter ${f.$}`);
    }).join('');
    defs.push(`<filter id="${id}" filterUnits="userSpaceOnUse" ${region}>${parts}</filter>`);
    return id;
  }

  // Registers the clipPath and mask definitions for a node and returns their ids.
  function clipMask(n, dx = 0, dy = 0, defineMask = true) {
    const shift = dx || dy ? `translate(${num(dx)} ${num(dy)}) ` : '';
    const out = {};
    if (n.Clip) {
      out.clip = next('clip');
      defs.push(`<clipPath id="${out.clip}"><path d="${pathData(n.Clip.Path.Commands)}" fill-rule="${n.Clip.Path.FillRule ? 'evenodd' : 'nonzero'}" transform="${shift}${matrix(n.Clip.Transform)}"/></clipPath>`);
    }
    if (n.Mask && defineMask) {
      out.mask = next('mask');
      defs.push(`<mask id="${out.mask}" style="mask-type:${n.Mask.Type ? 'luminance' : 'alpha'}"><g transform="${shift}${matrix(n.Mask.Transform)}">${node(n.Mask.Root)}</g></mask>`);
    }
    return out;
  }

  // Safari does not resolve `mask: url(#id)` to an inline SVG <mask> from an HTML element, so the HTML painter hands every browser the same
  // mask as an image: a data-URI SVG whose rect is cut by the D2 mask. An image mask is read as alpha, which is what the luminance mask yields.
  function cssMaskImage(n, dx, dy, w, h) {
    const shift = dx || dy ? `translate(${num(dx)} ${num(dy)}) ` : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}"><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${num(w)}" height="${num(h)}" style="mask-type:${n.Mask.Type ? 'luminance' : 'alpha'}"><g transform="${shift}${matrix(n.Mask.Transform)}">${node(n.Mask.Root)}</g></mask><rect width="${num(w)}" height="${num(h)}" mask="url(#m)"/></svg>`;
    const url = `url('data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}')`;
    return ['mask-image', '-webkit-mask-image'].map(k => `${k}:${url}`).concat(['mask-size', '-webkit-mask-size'].map(k => `${k}:100% 100%`), ['mask-repeat', '-webkit-mask-repeat'].map(k => `${k}:no-repeat`)).join(';');
  }

  const kids = n => (n.Children ?? []).map(c => { if (!c) throw new Error(`null child under ${n.ID ?? 'unnamed node'}`); return c; });

  function node(n) {
    if (!n) return '';
    const attrs = [];
    if (n.ID) attrs.push(`data-id="${esc(n.ID)}"`);
    if (n.Animations?.length) { attrs.push(`data-d2-anim="${animations.length}"`); animations.push(animationSpecs(n)); }
    if (!isIdentity(n.Transform)) attrs.push(`transform="${matrix(n.Transform)}"`);
    if (n.Opacity !== 1) attrs.push(`opacity="${num(n.Opacity)}"`);
    if (n.Blend) attrs.push(`style="mix-blend-mode:${BLEND[n.Blend]}"`);
    const { clip, mask } = clipMask(n);
    if (clip) attrs.push(`clip-path="url(#${clip})"`);
    if (mask) attrs.push(`mask="url(#${mask})"`);
    if (n.Filters?.length) attrs.push(`filter="url(#${filterDef(n.Filters)})"`);
    return `<g ${attrs.join(' ')}>${primitive(n.Primitive, n.ID)}${kids(n).map(node).join('')}</g>`;
  }

  // HTML mode: real elements where an HTML equivalent is exact enough, nested SVG for everything else. The reason for
  // every SVG fallback is counted so the share of the scene that can be plain DOM is a measurement, not a claim.
  const svgBox = inner => `<svg width="1" height="1" style="position:absolute;left:0;top:0;overflow:visible">${inner}</svg>`;
  const solid = p => p?.$ === 'SolidPaint';
  const rgba = c => { const [rgb, a] = split(c); return a === 1 ? rgb : rgb.replace('rgb', 'rgba').replace(')', `,${a})`); };
  const px = n => `${num(n)}px`;

  // Returns [markup, reason]: reason is set when the primitive must be SVG.
  function primitiveHtml(p, codeToken = false, id) {
    if (!p) return ['', null];
    const stroke = p.Stroke && p.Stroke.Paint && p.Stroke.Width > 0 ? p.Stroke : null;
    const strokeOk = !stroke || (solid(stroke.Paint) && !stroke.Dashes?.length && split(stroke.Paint.Color)[1] === 1);
    if (p.$ === 'Rect' || p.$ === 'Ellipse') {
      if (p.Fill && !solid(p.Fill)) return [null, 'gradient-or-pattern-fill'];
      if (!strokeOk) return [null, 'dashed-or-translucent-stroke'];
      const sw = stroke ? stroke.Width : 0;
      const box = p.$ === 'Rect' ? p.Box : { X: p.Center.X - p.RadiusX, Y: p.Center.Y - p.RadiusY, Width: 2 * p.RadiusX, Height: 2 * p.RadiusY };
      const radius = p.$ === 'Ellipse' ? '50%' : (p.RadiusX || p.RadiusY) ? `${px(p.RadiusX + sw / 2)} / ${px(p.RadiusY + sw / 2)}` : '0';
      const style = [`position:absolute`, `box-sizing:border-box`, `left:${px(box.X - sw / 2)}`, `top:${px(box.Y - sw / 2)}`, `width:${px(box.Width + sw)}`, `height:${px(box.Height + sw)}`, `border-radius:${radius}`];
      if (p.Fill) style.push(`background:${rgba(p.Fill.Color)}`);
      if (stroke) style.push(`border:${px(sw)} solid ${rgba(stroke.Paint.Color)}`);
      return [`<div data-k="${p.$.toLowerCase()}" style="${style.join(';')}"></div>`, null];
    }
    if (p.$ === 'TextRun') {
      if (!solid(p.Fill) || stroke) return [null, 'text-fill-or-stroke'];
      const decoration = [p.Underline && 'underline', p.Strike && 'line-through'].filter(Boolean).join(' ');
      const shift = ['0', '-50%', '-100%'][p.Anchor];
      // top is set after layout from the measured baseline (placeText in the spec); the empty inline-block marks it.
      return [`<div data-k="text" data-y="${num(p.Origin.Y)}" style="position:absolute;left:${px(p.Origin.X)};top:0;white-space:pre;line-height:normal;font-synthesis:none;font-family:${fontStack(p)};font-size:${px(p.Font.Size)};color:${rgba(p.Fill.Color)};transform:translateX(${shift})${decoration ? `;text-decoration:${decoration}` : ''}"><span data-baseline style="display:inline-block;width:0;height:0"></span>${esc(p.Text)}${codeToken ? '' : '\n'}</div>`, null];
    }
    if (p.$ === 'Image') {
      const asset = scene.Assets[p.Asset];
      const link = linkedImage(p, id);
      if (asset.$ !== 'RasterAsset' && !link) return [null, 'vector-image'];
      const a = p.Aspect.Align;
      const position = a ? `${['left', 'center', 'right'][(a - 1) % 3]} ${['top', 'center', 'bottom'][Math.floor((a - 1) / 3)]}` : 'center';
      if (link) count('html:linked-image');
      return [`<img data-k="image" alt="" ${link ? `src="${esc(link)}" referrerpolicy="no-referrer" decoding="async"` : `src="data:${asset.MIMEType};base64,${asset.Data}"`} style="position:absolute;left:${px(p.Box.X)};top:${px(p.Box.Y)};width:${px(p.Box.Width)};height:${px(p.Box.Height)};object-fit:${a ? (p.Aspect.Fit ? 'cover' : 'contain') : 'fill'};object-position:${position}">`, null];
    }
    return [null, p.$ === 'Path' ? 'path' : 'other'];
  }

  // Accessibility probe: every direct child of the root that is not a root:* helper is a D2 object or connection. It becomes a
  // focusable named group; the name is its label runs (or the ID when it has none). Paint is unchanged.
  const objectNodes = new Set((scene.Root?.Children ?? []).filter(c => c.ID && !c.ID.startsWith('root:')));
  const objects = new Set(a11y ? objectNodes : []);
  const labelOf = n => (n.Children ?? []).filter(c => c.ID?.startsWith(`${n.ID}:label:`)).map(c => c.Primitive?.Text).filter(Boolean).join(' ');
  // Spec 0006: names, nesting and descriptions are D2's own data (association payload, link regions) in ARIA form; no wording of ours.
  const info = new Map(association.map(o => [o.id, o]));
  const spelling = id => id.replace(/[()]/g, '').replace(/\[\d+\]$/, ''); // `c.(d -> e)[0]` is D2's key; this is its source spelling `c.d -> e`
  const nameOf = n => {
    const o = info.get(n.ID);
    if (o?.content) return o.label || n.ID; // markdown and code carry no label runs; the label is D2's text as written
    return labelOf(n) || (o?.kind === 'connection' ? spelling(n.ID) : n.ID);
  };
  const domId = new Map([...objects].map((n, i) => [n, `${idPrefix}o${i}`]));
  const byId = new Map([...objects].map(n => [n.ID, n]));
  const owned = new Map();
  for (const n of objects) { const parent = byId.get(info.get(n.ID)?.parent); if (parent) owned.set(parent, [...(owned.get(parent) ?? []), domId.get(n)]); }
  const tooltips = new Map();
  const a11yAttrs = n => {
    if (!objects.has(n)) return '';
    const o = info.get(n.ID);
    const description = [o?.kind === 'connection' && labelOf(n) ? spelling(n.ID) : '', tooltips.get(n) ?? ''].filter(Boolean).join('. ');
    return ` id="${domId.get(n)}" role="group" tabindex="0" aria-label="${esc(nameOf(n))}"${description ? ` aria-description="${esc(description)}"` : ''}${owned.has(n) ? ` aria-owns="${owned.get(n).join(' ')}"` : ''}`;
  };

  const linkOwner = new Map(linkOwners(scene, { objects: association }).map((id, i) => [scene.Links[i], (scene.Root.Children ?? []).find(n => n.ID === id)]));
  const objectFor = link => linkOwner.get(link);
  const linkName = l => { const n = objectFor(l); return n ? nameOf(n) : ''; };
  if (a11y) for (const l of scene.Links ?? []) { const n = l.Tooltip && objectFor(l); if (n && objects.has(n)) tooltips.set(n, l.Tooltip); }

  const usedLinks = new Set();
  let flowed = false;
  const contents = (tag, body) => `<${tag} style="display:contents;font:inherit;color:inherit;text-decoration:none">${body}</${tag}>`;

  function flowMarkdown(n) {
    const owner = (scene.Root.Children ?? []).find(o => o.Children?.includes(n));
    const object = info.get(owner?.ID);
    if (object?.content !== 'markdown' || !object.html) return null;
    const children = kids(n), runs = children.map(c => c.Primitive).filter(p => p?.$ === 'TextRun');
    // Only the characterized flat, translated markdown subtree can release its D2 clip.
    if (![scene.Root, owner, n].every(o => o.Transform.A === 1 && o.Transform.D === 1 && o.Transform.B === 0 && o.Transform.C === 0)
      || [scene.Root, owner].some(o => o.Clip || o.Mask || o.Filters?.length || o.Blend || o.Animations?.length)
      || !n.Clip || !isIdentity(n.Clip.Transform) || n.Mask || n.Filters?.length || n.Blend || n.Animations?.length || n.Primitive
      || children.some(c => !isIdentity(c.Transform) || c.Opacity !== 1 || c.Children?.length || c.Clip || c.Mask || c.Filters?.length || c.Blend || c.Animations?.length || !['TextRun', 'Rect'].includes(c.Primitive?.$))
      || !runs.length || runs.some(p => !p.Ink?.Valid || !solid(p.Fill) || p.Stroke?.Paint || p.Strike || p.Underline || !/^font:(SourceSansPro|SourceCodePro):/.test(p.Font.Asset))) return null;
    const parsed = renderMarkdown(object.html, hrefOf), clip = primBounds(n.Clip.Path);
    if (!parsed || !clip || clip[2] <= clip[0]) return null;
    // D2 clipped its own paint (its layout measure and its painter disagree, e.g. a lazy list continuation): no flow fits D2's box.
    if (runs.some(p => p.Ink.Max.X > clip[2] + .5 || p.Ink.Max.Y > clip[3] + .5)) return null;
    const headingSizes = [...parsed.html.matchAll(/<h([1-6])>/g)].map(m => [32, 24, 20, 16, 14, 13.6][+m[1] - 1]);
    if (runs.some(p => ![p.Font.Asset.startsWith('font:SourceCodePro:') ? 13.6 : 16, ...headingSizes].includes(p.Font.Size))) return null;
    const fonts = { regular: 'SourceSansPro:regular', semibold: 'SourceSansPro:semibold', bold: 'SourceSansPro:bold', italic: 'SourceSansPro:italic', mono: 'SourceCodePro:regular' };
    if (/<(?:p|li|td)\b/.test(parsed.html) && !scene.Assets?.['font:SourceSansPro:regular']) return null;
    const stacks = new Map();
    for (const p of runs) {
      const stack = fontStack(p);
      if (stacks.has(p.Font.Asset) && stacks.get(p.Font.Asset) !== stack) return null;
      stacks.set(p.Font.Asset, stack);
    }
    const needed = [...(headingSizes.length || /<th\b/.test(parsed.html) ? ['semibold'] : []), ...(/<(?:strong|b)>/.test(parsed.html) ? ['bold'] : []), ...(/<em>/.test(parsed.html) ? ['italic'] : []), ...(/<code>/.test(parsed.html) ? ['mono'] : [])];
    if (needed.some(role => !runs.some(p => p.Font.Asset === `font:${fonts[role]}`))) return null;
    const variables = Object.entries(fonts).map(([role, id]) => `--md-${role}:${stacks.get(`font:${id}`) ?? fontFamily(`font:${id}`)}`);
    const dx = scene.Root.Transform.E + owner.Transform.E + n.Transform.E, dy = scene.Root.Transform.F + owner.Transform.F + n.Transform.F;
    const links = (scene.Links ?? []).filter(l => parsed.links.includes(l.URL) && l.Box.X >= dx + clip[0] && l.Box.Y >= dy + clip[1] && l.Box.X + l.Box.Width <= dx + clip[2] + .001 && l.Box.Y + l.Box.Height <= dy + clip[3] + .001);
    // Preserve D2's decision to disable inline links when the whole object is linked.
    if (parsed.links.some(url => hrefOf(url) && !links.some(l => l.URL === url))) return null;
    const linked = p => links.some(l => l.Box.X < dx + p.Ink.Max.X && l.Box.X + l.Box.Width > dx + p.Ink.Min.X && l.Box.Y < dy + p.Ink.Max.Y && l.Box.Y + l.Box.Height > dy + p.Ink.Min.Y);
    const rects = children.map(c => c.Primitive).filter(p => p.$ === 'Rect' && solid(p.Fill));
    // D2 paints a table as its background, row stripes and a 1 px grid (markdown_svg.go paintTable); only the grid has 1 px wide rects.
    const column = rects.find(p => p.Box.Width === 1 && p.Box.Height > 1);
    const grid = p => column && p.Box.X === column.Box.X && p.Box.Y >= column.Box.Y && p.Box.Y <= column.Box.Y + column.Box.Height;
    const table = column && rects.find(p => p.Box.X === column.Box.X && p.Box.Y === column.Box.Y && p.Box.Width > 1 && p.Box.Height > 1);
    const stripe = table && rects.find(p => p.Box.X === table.Box.X + 1 && p.Box.Width > 1 && p.Box.Height > 1 && p.RadiusX === 0);
    if (/<table\b/.test(parsed.html) && !table) return null;
    const quote = rects.find(p => p.Box.X === 0 && p.Box.Width === 4);
    const muted = runs.find(p => quote && p.Origin.X >= 20 && p.Origin.Y > quote.Box.Y && p.Origin.Y < quote.Box.Y + quote.Box.Height) ?? runs.find(p => p.Font.Asset === 'font:SourceSansPro:semibold' && p.Font.Size === 13.6);
    const foreground = runs.find(p => !linked(p) && p !== muted && p.Font.Asset.startsWith('font:SourceSansPro:')) ?? runs[0];
    for (const [role, paint] of Object.entries({ accent: runs.find(linked)?.Fill, muted: muted?.Fill, border: quote?.Fill ?? rects.find(p => p.Box.Height === 4)?.Fill, 'border-muted': rects.find(p => p.Box.Height === 1 && !grid(p))?.Fill, code: rects.find(p => p.RadiusX === 6)?.Fill, table: table?.Fill, 'table-stripe': stripe?.Fill, 'table-border': column?.Fill })) {
      if (paint) variables.push(`--md-${role}:${rgba(paint.Color)}`);
    }
    // D2's box for this markdown is the clip it applied to it, not the ink of its runs (which leaves out padding and rules).
    const bounds = clip;
    links.forEach(l => usedLinks.add(l));
    flowed = true; count('html:markdown-flow');
    // Keep the markdown node's origin and opacity; deliberately do not install its clip or a fixed height.
    const style = `position:absolute;left:0;top:0;transform-origin:0 0;transform:${matrix(n.Transform).replaceAll(' ', ',')};opacity:${num(n.Opacity)}`;
    const background = children.find(c => c.ID === `${n.ID}:background`);
    return `<div data-id="${esc(n.ID)}" style="${style}">${background ? nodeHtml(background) : ''}<div data-flow-markdown data-flow-d2="${esc(JSON.stringify({ x: bounds[0], y: bounds[1], width: bounds[2] - bounds[0], height: bounds[3] - bounds[1] }))}" style="position:absolute;left:${px(clip[0])};top:${px(clip[1])};width:${px(clip[2] - clip[0])};color:${rgba(foreground.Fill.Color)};${variables.join(';')}">${parsed.html}</div></div>`;
  }

  function markdownHtml(n, children) {
    const owner = (scene.Root.Children ?? []).find(o => o.Children?.includes(n));
    const source = info.get(owner?.ID)?.label;
    if (!source || info.get(owner.ID)?.content !== 'markdown') return null;
    // Pinned to D2 v0.9.0: github-markdown.css:31,70-75,233-265 (16px base; h1..h6 = 32,24,20,16,14,13.6).
    // shortcut: only unambiguous single-line blocks and literal fences; nested/continued blocks need D2 block provenance.
    if (children.some((c, i) => c.ID !== `${n.ID}:primitive:${i}` || !isIdentity(c.Transform) || c.Children?.length || c.Filters?.length || c.Clip || c.Mask || c.Blend || c.Animations?.length || !['TextRun', 'Rect'].includes(c.Primitive?.$))) return null;
    const headings = new Set(), paragraphs = new Set(), quotes = new Set(), lists = new Set(), fences = new Set();
    const lines = source.replace(/\r\n?/g, '\n').split('\n'), prose = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^ {0,3}(?:`{3,}|~{3,})/.test(lines[i])) { prose.push(lines[i]); continue; }
      if (!/^```[\w-]*$/.test(lines[i])) return null;
      const start = ++i;
      while (i < lines.length && lines[i] !== '```') i++;
      if (i === lines.length) return null;
      fences.add(lines.slice(start, i).join('\n')); prose.push('', '');
    }
    let rule = false;
    for (const block of prose.join('\n').split(/\n[ \t]*\n/)) {
      const lines = block.split('\n');
      if (lines.every(s => /^[-+*] \S/.test(s)) || lines.every(s => /^\d+\. \S/.test(s))) { lists.add(block); continue; }
      while (/^#{1,6} \S/.test(lines[0] ?? '')) headings.add(lines.shift());
      if (lines.length !== 1) continue;
      if (/^> \S/.test(lines[0])) quotes.add(lines[0]);
      else if (/^(---+|\*\*\*+|___+)$/.test(lines[0])) rule = true;
      else if (!/^[\s#>*_`~|+-]/.test(lines[0])) paragraphs.add(lines[0]);
    }
    const viewport = primBounds(n.Clip?.Path), width = viewport?.[2];
    const translation = [scene.Root, owner, n].every(o => o.Transform.A === 1 && o.Transform.D === 1 && o.Transform.B === 0 && o.Transform.C === 0);
    const dx = translation ? scene.Root.Transform.E + owner.Transform.E + n.Transform.E : 0;
    const dy = translation ? scene.Root.Transform.F + owner.Transform.F + n.Transform.F : 0;
    const mono = p => p?.Font?.Asset === 'font:SourceCodePro:regular' && p.Font.Size === 13.6;
    const rowEnd = start => { let end = start; const y = children[start]?.Primitive?.Origin?.Y; while (children[end]?.Primitive?.$ === 'TextRun' && children[end].Primitive.Origin.Y === y) end++; return end; };
    const textOf = nodes => nodes.filter(c => c.Primitive.$ === 'TextRun').map(c => c.Primitive.Text).join('');
    // Reconstruct only a candidate spelling from painted fonts/regions, then require an exact source block match.
    const inline = nodes => {
      const marks = new Map(); let spelling = '';
      for (const c of nodes) {
        const p = c.Primitive;
        if (p.$ !== 'TextRun') continue;
        let tag = '', text = p.Text, link;
        if (p.Font.Asset === 'font:SourceSansPro:bold' && p.Font.Size === 16) { tag = 'strong'; text = `**${text}**`; }
        else if (p.Font.Asset === 'font:SourceSansPro:italic' && p.Font.Size === 16) { tag = 'em'; text = `*${text}*`; }
        else if (mono(p) && nodes.some(c => c.Primitive.$ === 'Rect' && c.Primitive.Box.X <= p.Origin.X && c.Primitive.Box.X + c.Primitive.Box.Width > p.Origin.X && c.Primitive.Box.Y < p.Origin.Y && c.Primitive.Box.Y + c.Primitive.Box.Height > p.Origin.Y)) { tag = 'code'; text = '`' + text + '`'; }
        else if (p.Font.Asset !== 'font:SourceSansPro:regular' || p.Font.Size !== 16) return null;
        if (!tag && translation) {
          const ink = p.Ink;
          // D2 clips link regions to the markdown viewport; glyph ink can extend above its top edge.
          const box = ink?.Valid && [Math.max(ink.Min.X, viewport?.[0] ?? -Infinity), Math.max(ink.Min.Y, viewport?.[1] ?? -Infinity), Math.min(ink.Max.X, viewport?.[2] ?? Infinity), Math.min(ink.Max.Y, viewport?.[3] ?? Infinity)];
          const matches = (scene.Links ?? []).filter(l => l.URL && box && Math.abs(l.Box.X - dx - box[0]) < .001 && Math.abs(l.Box.Y - dy - box[1]) < .001 && Math.abs(l.Box.Width - (box[2] - box[0])) < .001 && Math.abs(l.Box.Height - (box[3] - box[1])) < .001);
          if (matches.length === 1) { link = matches[0]; tag = 'a'; text = `[${text}](${link.URL})`; }
        }
        spelling += text;
        if (tag) marks.set(c, { tag, link });
      }
      return { spelling, marks };
    };
    const render = (nodes, marks = new Map()) => nodes.map(c => {
      let body = nodeHtml(c);
      const mark = marks.get(c);
      if (!mark) return body;
      const l = mark.link;
      if (!l) return contents(mark.tag, body);
      usedLinks.add(l);
      // Move the existing hit region into the text anchor; no second anchor or keyboard stop.
      // No data-k=link here: the DOM renderer resolves nested hits through their object, not these local coordinates.
      body += `<span style="position:absolute;left:${px(l.Box.X - dx)};top:${px(l.Box.Y - dy)};width:${px(l.Box.Width)};height:${px(l.Box.Height)}"></span>`;
      // A positioned anchor at the same origin stays focusable even in browsers that cannot focus display:contents.
      return `<a${hrefOf(l.URL) ? ` href="${esc(l.URL)}"` : ''}${l.Target ? ` data-target="${esc(l.Target)}"` : ''}${l.Tooltip ? ` title="${esc(l.Tooltip)}"` : ''} style="position:absolute;left:0;top:0;font:inherit;color:inherit;text-decoration:none">${body}</a>`;
    }).join('');
    let body = '';
    for (let i = 0; i < children.length;) {
      const p = children[i].Primitive, next = children[i + 1]?.Primitive;
      const level = p.$ === 'TextRun' && p.Font.Asset === 'font:SourceSansPro:semibold' ? ({ 32: 1, 24: 2, 20: 3 })[p.Font.Size] : 0;
      if (level && p.Origin.X === 0 && headings.has(`${'#'.repeat(level)} ${p.Text}`)) {
        const end = i + (level < 3 && next?.$ === 'Rect' && next.Box.X === 0 && next.Box.Width === width && next.Box.Height === 1 ? 2 : 1);
        body += contents(`h${level}`, render(children.slice(i, end))); i = end; continue;
      }
      const bullet = q => q?.$ === 'Rect' && q.Box.X === 15 && q.Box.Width === 5 && q.Box.Height === 5;
      const ordered = q => q?.$ === 'TextRun' && /^\d+\.$/.test(q.Text) && q.Origin.X > 0 && q.Origin.X < 32 && q.Font.Size === 16;
      if (bullet(p) || ordered(p)) {
        const tag = bullet(p) ? 'ul' : 'ol', items = []; let end = i;
        while ((tag === 'ul' ? bullet : ordered)(children[end]?.Primitive)) {
          const marker = children[end].Primitive, first = children[end + 1]?.Primitive;
          if (first?.$ !== 'TextRun' || first.Origin.X !== 32 || (tag === 'ol' && first.Origin.Y !== marker.Origin.Y)) break;
          const stop = rowEnd(end + 1), nodes = children.slice(end, stop), line = inline(nodes.slice(1));
          if (!line) break;
          items.push({ nodes, line, prefix: tag === 'ul' ? '- ' : marker.Text + ' ' }); end = stop;
        }
        if (items.length && lists.has(items.map(item => item.prefix + item.line.spelling).join('\n'))) {
          body += contents(tag, items.map(item => contents('li', render(item.nodes, item.line.marks))).join('')); i = end; continue;
        }
      }
      if (p.$ === 'Rect' && p.Box.X === 0 && p.Box.Width === width && p.Box.Height === 4 && rule) {
        body += '<hr style="display:contents">' + nodeHtml(children[i++]); continue;
      }
      if (p.$ === 'Rect' && p.Box.X === 0 && p.Box.Width === width && p.Box.Height > 32 && p.RadiusX === 6) {
        let end = i + 1;
        while (mono(children[end]?.Primitive) && children[end].Primitive.Origin.X === 16 && children[end].Primitive.Origin.Y > p.Box.Y && children[end].Primitive.Origin.Y < p.Box.Y + p.Box.Height) end++;
        if (end > i + 1 && fences.has(children.slice(i + 1, end).map(c => c.Primitive.Text).join('\n'))) {
          body += contents('pre', contents('code', render(children.slice(i, end)))); i = end; continue;
        }
      }
      if (p.$ === 'TextRun' && p.Origin.X === 20) {
        const end = rowEnd(i), border = children[end]?.Primitive, nodes = children.slice(i, end);
        if (border?.$ === 'Rect' && border.Box.X === 0 && border.Box.Width === 4 && border.Box.Y < p.Origin.Y && border.Box.Y + border.Box.Height > p.Origin.Y && quotes.has('> ' + textOf(nodes))) {
          body += contents('blockquote', render(children.slice(i, end + 1))); i = end + 1; continue;
        }
      }
      let start = i;
      while (children[start]?.Primitive.$ === 'Rect' && children[start].Primitive.Box.X > 0) start++;
      if (children[start]?.Primitive.$ === 'TextRun' && children[start].Primitive.Origin.X === 0) {
        const end = rowEnd(start), nodes = children.slice(i, end), line = inline(nodes);
        if (line && paragraphs.has(line.spelling)) { body += render(nodes, line.marks); i = end; continue; }
      }
      body += nodeHtml(children[i++]);
    }
    return body;
  }

  // Table/line wrappers do not shift coordinates; the code pre shares the object's origin.
  function childrenHtml(n) {
    const children = kids(n);
    if (n.ID?.endsWith(':markdown')) { const body = markdownHtml(n, children); if (body !== null) return body; }
    if (children.some(c => c.ID === `${n.ID}:code-background`)) {
      const lines = new Map();
      const other = [];
      for (const c of children) {
        const match = c.ID?.slice(n.ID.length).match(/^:code-line:(\d+):token:\d+$/);
        if (match) { const line = +match[1]; if (!lines.has(line)) lines.set(line, []); lines.get(line).push(c); }
        else other.push(nodeHtml(c));
      }
      // D2 advances over whitespace-only tokens without emitting runs; its label supplies those gaps and empty lines.
      const source = info.get(n.ID)?.label?.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
      const count = [...lines.keys()].reduce((max, i) => Math.max(max, i + 1), source?.length ?? 0);
      const blocks = [];
      for (let i = 0; i < count; i++) {
        let cursor = 0, body = '';
        for (const token of lines.get(i) ?? []) {
          const text = token.Primitive.Text;
          const start = source ? source[i].indexOf(text, cursor) : cursor;
          if (start < 0) throw new Error(`code run ${token.ID} is absent from D2's label`);
          body += esc(source?.[i].slice(cursor, start) ?? '') + nodeHtml(token, true);
          cursor = start + text.length;
        }
        body += esc(source?.[i].slice(cursor) ?? '');
        blocks.push(`<span style="display:block">${body}${i + 1 < count ? '\n' : ''}</span>`);
      }
      return other.join('') + `<pre style="position:absolute;left:0;top:0;margin:0;padding:0;border:0;font:inherit;white-space:pre"><code style="font:inherit">${blocks.join('')}</code></pre>`;
    }
    const table = children.some(c => c.ID === `${n.ID}:table-header` || c.ID === `${n.ID}:class-header`);
    if (!table) {
      // A multi-line label is several runs in D2's scene (`label:0`, `label:1`, ...); group them as one paragraph. display:contents moves nothing.
      let out = '', lines = [];
      const paragraph = () => { out += lines.length > 1 ? `<div role="paragraph" data-label style="display:contents">${lines.join('')}</div>` : lines.join(''); lines = []; };
      for (const c of children) {
        if (c.ID && /^:label:\d+$/.test(c.ID.slice(n.ID.length))) lines.push(nodeHtml(c));
        else { paragraph(); out += nodeHtml(c); }
      }
      paragraph();
      return out;
    }
    const wrap = (role, body) => `<div${a11y ? ` role="${role}"` : ''} style="display:contents">${body}</div>`;
    let body = '', row = '', key = null;
    const flush = () => { if (key !== null) body += wrap('row', key === 'header' ? wrap('columnheader', row) : row); row = ''; };
    for (const c of children) {
      const part = c.ID?.slice(n.ID.length);
      const header = /^:(?:table|class)-header(?:-label(?::\d+)?)?$/.test(part);
      const match = part?.match(/^:(table-row|class-field|class-method):(\d+):(name|type|constraint|prefix|separator)$/);
      const next = header ? 'header' : match ? `${match[1]}:${match[2]}` : null;
      if (next !== key) { flush(); key = next; }
      let markup = nodeHtml(c);
      if (match && match[3] !== 'separator') markup = wrap('cell', markup);
      if (key === null) body += markup;
      else row += markup;
    }
    flush();
    return `<div${a11y ? ` role="table" aria-label="${esc(nameOf(n))}"` : ''} style="display:contents">${body}</div>`;
  }

  function nodeHtml(n, codeToken = false) {
    if (!n) return '';
    if (flow && n.ID?.endsWith(':markdown')) { const body = flowMarkdown(n); if (body !== null) return body; }
    const heavy = n.Filters?.length || n.Blend || n.Animations?.length;
    const effect = heavy || ((n.Clip || n.Mask) && !cssMasks);
    if (effect) {
      const before = inEffect;
      inEffect = true;
      const out = svgBox(node(objectNodes.has(n) ? { ...n, ID: '' } : n));
      inEffect = before;
      count('svg:effect-subtree-nodes');
      for (const [kind, on] of Object.entries({ mask: n.Mask, clip: n.Clip, filter: n.Filters?.length, blend: n.Blend, animation: n.Animations?.length })) if (on) count(`effect:${kind}`);
      return objectNodes.has(n) ? `<div data-id="${esc(n.ID)}"${a11yAttrs(n)} style="position:absolute;left:0;top:0">${out}</div>` : out;
    }
    const style = ['position:absolute', 'left:0', 'top:0', 'transform-origin:0 0'];
    // CSS matrix() needs commas; the SVG attribute form with spaces is silently ignored there.
    if (!isIdentity(n.Transform)) style.push(`transform:${matrix(n.Transform).replaceAll(' ', ',')}`);
    if (n.Opacity !== 1) style.push(`opacity:${num(n.Opacity)}`);
    if ((n.Clip || n.Mask) && cssMasks === 'subtree') {
      // The group's box is its painted bounds, so mask and clip rasters stay small. Mask and clip coordinates are relative to the
      // box, so their definitions are shifted back, and the transform origin stays at the local origin.
      const b = subtreeBounds(n);
      const [bx, by] = b ? [Math.floor(b[0]) - 2, Math.floor(b[1]) - 2] : [0, 0];
      const [w, h] = b ? [Math.ceil(b[2]) - bx + 2, Math.ceil(b[3]) - by + 2] : [0, 0];
      const { clip } = clipMask(n, -bx, -by, false);
      const outer = ['position:absolute', `left:${px(bx)}`, `top:${px(by)}`, `width:${px(w)}`, `height:${px(h)}`, `transform-origin:${px(-bx)} ${px(-by)}`];
      if (!isIdentity(n.Transform)) outer.push(`transform:${matrix(n.Transform).replaceAll(' ', ',')}`);
      if (n.Opacity !== 1) outer.push(`opacity:${num(n.Opacity)}`);
      if (clip) { outer.push(`clip-path:url(#${clip})`); count('html:clipped-group'); }
      if (n.Mask) { outer.push(cssMaskImage(n, -bx, -by, w, h)); count('html:masked-group'); }
      let own = '';
      if (n.Primitive) {
        const [markup, reason] = primitiveHtml(n.Primitive, codeToken, n.ID);
        if (markup === null) { own = svgBox(primitive(n.Primitive, n.ID)); count(`svg:${reason}`); } else if (markup) { own = markup; count(`html:${n.Primitive.$}`); }
      }
      return `<div${n.ID ? ` data-id="${esc(n.ID)}"` : ''}${a11yAttrs(n)} style="${outer.join(';')}"><div style="position:absolute;left:${px(-bx)};top:${px(-by)}">${own}${childrenHtml(n)}</div></div>`;
    }
    if (n.Clip || n.Mask) {
      // CSS clip-path/mask by url() refer to the element's border box, so the group gets the document extent at the local origin.
      const { clip } = clipMask(n, 0, 0, false);
      const [gw, gh] = [Math.max(v.X + v.Width, v.Width), Math.max(v.Y + v.Height, v.Height)];
      style.push(`width:${px(gw)}`, `height:${px(gh)}`);
      if (clip) { style.push(`clip-path:url(#${clip})`); count('html:clipped-group'); }
      if (n.Mask) { style.push(cssMaskImage(n, 0, 0, gw, gh)); count('html:masked-group'); }
    }
    let own = '';
    if (n.Primitive) {
      const [markup, reason] = primitiveHtml(n.Primitive, codeToken, n.ID);
      if (markup === null) { own = svgBox(primitive(n.Primitive, n.ID)); count(`svg:${reason}`); } else if (markup) { own = markup; count(`html:${n.Primitive.$}`); }
    }
    return `<div${n.ID ? ` data-id="${esc(n.ID)}"` : ''}${a11yAttrs(n)} style="${style.join(';')}">${own}${childrenHtml(n)}</div>`;
  }

  if (html) {
    const body = nodeHtml(scene.Root);
    let sx = scene.LogicalWidth / v.Width, sy = scene.LogicalHeight / v.Height;
    if (scene.ViewportFit) sx = sy = Math.min(sx, sy);
    const centered = scene.ViewportFit && scene.ViewportAlign;
    const dx = centered ? (scene.LogicalWidth - v.Width * sx) / 2 : 0;
    const dy = centered ? (scene.LogicalHeight - v.Height * sy) / 2 : 0;
    // Tooltips (ADR 0009: shown on hover and on keyboard focus). `title` stays for hover; the element below shows when the object's group or the link has focus-visible.
    // It is d2web's one piece of behaviour for a tooltip: system colours, 12 CSS px whatever the zoom, and a `part` for the consumer to restyle.
    const tipRules = [];
    // `data-link` is the region's index in scene.Links, which the DOM view uses to find its owner.
    const links = (scene.Links ?? []).flatMap((l, at) => (usedLinks.has(l) ? [] : [[l, at]])).map(([l, at], i) => {
      const anchor = `<a data-k="link" data-link="${at}"${l.Tooltip ? ` id="${idPrefix}lk${i}"` : ''} ${hrefOf(l.URL ?? '') ? `href="${esc(l.URL)}"` : ''}${(l.URL || l.Target) && linkName(l) ? ` aria-label="${esc(linkName(l))}"` : ''}${l.Target ? ` data-target="${esc(l.Target)}"` : ''}${l.Tooltip ? ` title="${esc(l.Tooltip)}"` : ''} style="position:absolute;left:${px(l.Box.X)};top:${px(l.Box.Y)};width:${px(l.Box.Width)};height:${px(l.Box.Height)}"></a>`;
      if (!l.Tooltip) return anchor;
      const group = objectFor(l), focus = [`#${idPrefix}lk${i}:focus-visible`, group && domId.has(group) ? `#${domId.get(group)}:focus-visible` : ''].filter(Boolean).join(',');
      tipRules.push(`[data-d2-scene]:has(${focus}) #${idPrefix}tip${i}{display:block}`, `#${idPrefix}lk${i}:focus-visible+#${idPrefix}tip${i}{display:block}`); // second rule: no :has() needed for a focusable link
      const k = 1 / sx;
      // Flip toward the board's middle so the scene's clip does not cut it: right-aligned in the right half, above in the lower half.
      const left = l.Box.X + l.Box.Width / 2 > v.X + v.Width / 2, above = l.Box.Y + l.Box.Height / 2 > v.Y + v.Height / 2;
      const flip = `${left ? 'translateX(-100%)' : ''}${above ? 'translateY(-100%)' : ''}`;
      return anchor + `<span id="${idPrefix}tip${i}" role="tooltip" part="tooltip" style="position:absolute;left:${px(left ? l.Box.X + l.Box.Width : l.Box.X)};top:${px(above ? l.Box.Y - 4 * k : l.Box.Y + l.Box.Height + 4 * k)};${flip ? `transform:${flip};` : ''}z-index:1;white-space:pre;font:${num(12 * k)}px system-ui,sans-serif;padding:${px(2 * k)} ${px(6 * k)};color:CanvasText;background:Canvas;border:${px(k)} solid currentColor;border-radius:${px(3 * k)}">${esc(l.Tooltip)}</span>`;
    }).join('');
    return {
      html: `${flowed || tipRules.length ? `<style>${flowed ? markdownCSS : ''}${tipRules.length ? '[data-d2-scene] [role=tooltip]{display:none}' : ''}${tipRules.join('')}[data-d2-scene] [role=tooltip][data-dismissed]{display:none!important}</style>` : ''}<svg width="0" height="0" style="position:absolute"><defs>${defs.join('')}</defs></svg><div data-d2-scene style="position:relative;overflow:${flowed ? 'visible' : 'hidden'};width:${px(scene.LogicalWidth)};height:${px(scene.LogicalHeight)}"><div style="position:absolute;left:0;top:0;transform-origin:0 0;transform:translate(${px(dx)},${px(dy)}) scale(${num(sx)},${num(sy)}) translate(${px(-v.X)},${px(-v.Y)})">${body}${links}</div></div>`,
      stats: { ...stats, links: scene.Links?.length ?? 0 },
      animated: JSON.stringify(scene.Root).includes('"Animations":[{'),
      animations,
    };
  }
  const body = node(scene.Root);
  const fit = scene.ViewportFit ? `${scene.ViewportAlign ? 'xMidYMid' : 'xMinYMin'} meet` : 'none';
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${num(scene.LogicalWidth)}" height="${num(scene.LogicalHeight)}" viewBox="${[v.X, v.Y, v.Width, v.Height].map(num).join(' ')}" preserveAspectRatio="${fit}"><defs>${defs.join('')}</defs>${body}</svg>`,
    animated: JSON.stringify(scene.Root).includes('"Animations":[{'),
    animations,
  };
}
