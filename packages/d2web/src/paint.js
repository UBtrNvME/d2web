// Painter: turns the scene JSON of spec 0001 (packages/d2web-wasm/scenejson) into SVG or HTML-first markup. It covers every primitive,
// paint, clip, mask, filter and blend kind in the corpus; animations are not painted. Moved from the research tree; behaviour unchanged.
import { animationSpecs } from './animation.js';
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

  function primitive(p) {
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
  function clipMask(n, dx = 0, dy = 0) {
    const shift = dx || dy ? `translate(${num(dx)} ${num(dy)}) ` : '';
    const out = {};
    if (n.Clip) {
      out.clip = next('clip');
      defs.push(`<clipPath id="${out.clip}"><path d="${pathData(n.Clip.Path.Commands)}" fill-rule="${n.Clip.Path.FillRule ? 'evenodd' : 'nonzero'}" transform="${shift}${matrix(n.Clip.Transform)}"/></clipPath>`);
    }
    if (n.Mask) {
      out.mask = next('mask');
      defs.push(`<mask id="${out.mask}" style="mask-type:${n.Mask.Type ? 'luminance' : 'alpha'}"><g transform="${shift}${matrix(n.Mask.Transform)}">${node(n.Mask.Root)}</g></mask>`);
    }
    return out;
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
    return `<g ${attrs.join(' ')}>${primitive(n.Primitive)}${kids(n).map(node).join('')}</g>`;
  }

  // HTML mode: real elements where an HTML equivalent is exact enough, nested SVG for everything else. The reason for
  // every SVG fallback is counted so the share of the scene that can be plain DOM is a measurement, not a claim.
  const svgBox = inner => `<svg width="1" height="1" style="position:absolute;left:0;top:0;overflow:visible">${inner}</svg>`;
  const solid = p => p?.$ === 'SolidPaint';
  const rgba = c => { const [rgb, a] = split(c); return a === 1 ? rgb : rgb.replace('rgb', 'rgba').replace(')', `,${a})`); };
  const px = n => `${num(n)}px`;

  // Returns [markup, reason]: reason is set when the primitive must be SVG.
  function primitiveHtml(p, codeToken = false) {
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
      if (asset.$ !== 'RasterAsset') return [null, 'vector-image'];
      const a = p.Aspect.Align;
      const position = a ? `${['left', 'center', 'right'][(a - 1) % 3]} ${['top', 'center', 'bottom'][Math.floor((a - 1) / 3)]}` : 'center';
      return [`<img data-k="image" alt="" src="data:${asset.MIMEType};base64,${asset.Data}" style="position:absolute;left:${px(p.Box.X)};top:${px(p.Box.Y)};width:${px(p.Box.Width)};height:${px(p.Box.Height)};object-fit:${a ? (p.Aspect.Fit ? 'cover' : 'contain') : 'fill'};object-position:${position}">`, null];
    }
    return [null, p.$ === 'Path' ? 'path' : 'other'];
  }

  // Conservative painted bounds [x0, y0, x1, y1] of a node's subtree in the node's local coordinates, excluding its own transform.
  function primBounds(p) {
    if (!p) return null;
    const pad = (p.Stroke?.Paint && p.Stroke.Width > 0 ? p.Stroke.Width * 2 : 0);
    if (p.$ === 'Rect' || p.$ === 'Image') return [p.Box.X - pad, p.Box.Y - pad, p.Box.X + p.Box.Width + pad, p.Box.Y + p.Box.Height + pad];
    if (p.$ === 'Ellipse') return [p.Center.X - p.RadiusX - pad, p.Center.Y - p.RadiusY - pad, p.Center.X + p.RadiusX + pad, p.Center.Y + p.RadiusY + pad];
    if (p.$ === 'Path') {
      const b = [Infinity, Infinity, -Infinity, -Infinity];
      for (const c of p.Commands) for (const q of c.Kind === 5 ? [] : [c.P1, ...(c.Kind >= 2 && c.Kind <= 3 ? [c.P2] : []), ...(c.Kind === 3 ? [c.P3] : [])]) {
        const r = c.Kind === 4 ? Math.max(c.RadiusX, c.RadiusY) : 0;
        b[0] = Math.min(b[0], q.X - r - pad); b[1] = Math.min(b[1], q.Y - r - pad); b[2] = Math.max(b[2], q.X + r + pad); b[3] = Math.max(b[3], q.Y + r + pad);
      }
      return b[0] === Infinity ? null : b;
    }
    if (p.$ === 'TextRun') { const w = p.Text.length * p.Font.Size; return [p.Origin.X - w, p.Origin.Y - 2 * p.Font.Size, p.Origin.X + w, p.Origin.Y + p.Font.Size]; }
    return null;
  }
  function subtreeBounds(n) {
    let b = primBounds(n.Primitive);
    for (const c of n.Children ?? []) {
      const cb = subtreeBounds(c);
      if (!cb) continue;
      const m = c.Transform;
      for (const [x, y] of [[cb[0], cb[1]], [cb[2], cb[1]], [cb[0], cb[3]], [cb[2], cb[3]]]) {
        const X = m.A * x + m.C * y + m.E, Y = m.B * x + m.D * y + m.F;
        b = b ? [Math.min(b[0], X), Math.min(b[1], Y), Math.max(b[2], X), Math.max(b[3], Y)] : [X, Y, X, Y];
      }
    }
    return b;
  }

  // Accessibility probe: every direct child of the root that is not a root:* helper is a D2 object or connection. It becomes a
  // focusable named group; the name is its label runs (or the ID when it has none). Paint is unchanged.
  const objects = new Set(a11y ? (scene.Root?.Children ?? []).filter(c => c.ID && !c.ID.startsWith('root:')) : []);
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

  // A link region carries no object ID; it belongs to the smallest D2 object whose bounds hold the region (within its stroke).
  function objectFor(l) {
    let best = null, area = Infinity;
    for (const n of scene.Root?.Children ?? []) {
      if (!n.ID || n.ID.startsWith('root:')) continue;
      const b = subtreeBounds(n), m = n.Transform;
      if (!b || !m) continue;
      const x0 = m.A * b[0] + m.E - 4, y0 = m.D * b[1] + m.F - 4, x1 = m.A * b[2] + m.E + 4, y1 = m.D * b[3] + m.F + 4;
      const r = l.Box;
      if (r.X >= x0 && r.Y >= y0 && r.X + r.Width <= x1 && r.Y + r.Height <= y1 && (x1 - x0) * (y1 - y0) < area) { area = (x1 - x0) * (y1 - y0); best = n; }
    }
    return best;
  }
  const linkName = l => { const n = objectFor(l); return n ? nameOf(n) : ''; };
  if (a11y) for (const l of scene.Links ?? []) { const n = l.Tooltip && objectFor(l); if (n && objects.has(n)) tooltips.set(n, l.Tooltip); }

  const usedLinks = new Set();
  let flowed = false;
  const contents = (tag, body) => `<${tag} style="display:contents;font:inherit;color:inherit;text-decoration:none">${body}</${tag}>`;

  function flowMarkdown(n) {
    const owner = (scene.Root.Children ?? []).find(o => o.Children?.includes(n));
    const object = info.get(owner?.ID);
    if (object?.content !== 'markdown' || !object.label) return null;
    const children = kids(n), runs = children.map(c => c.Primitive).filter(p => p?.$ === 'TextRun');
    // Only the characterized flat, translated markdown subtree can release its D2 clip.
    if (![scene.Root, owner, n].every(o => o.Transform.A === 1 && o.Transform.D === 1 && o.Transform.B === 0 && o.Transform.C === 0)
      || [scene.Root, owner].some(o => o.Clip || o.Mask || o.Filters?.length || o.Blend || o.Animations?.length)
      || !n.Clip || !isIdentity(n.Clip.Transform) || n.Mask || n.Filters?.length || n.Blend || n.Animations?.length || n.Primitive
      || children.some(c => !isIdentity(c.Transform) || c.Opacity !== 1 || c.Children?.length || c.Clip || c.Mask || c.Filters?.length || c.Blend || c.Animations?.length || !['TextRun', 'Rect'].includes(c.Primitive?.$))
      || !runs.length || runs.some(p => !p.Ink?.Valid || !solid(p.Fill) || p.Stroke?.Paint || p.Strike || p.Underline || !/^font:(SourceSansPro|SourceCodePro):/.test(p.Font.Asset))) return null;
    const parsed = renderMarkdown(object.label, hrefOf), clip = primBounds(n.Clip.Path);
    if (!parsed || !clip || clip[2] <= clip[0]) return null;
    const headingSizes = [...parsed.html.matchAll(/<h([1-6])>/g)].map(m => [32, 24, 20, 16, 14, 13.6][+m[1] - 1]);
    if (runs.some(p => ![p.Font.Asset.startsWith('font:SourceCodePro:') ? 13.6 : 16, ...headingSizes].includes(p.Font.Size))) return null;
    const fonts = { regular: 'SourceSansPro:regular', semibold: 'SourceSansPro:semibold', bold: 'SourceSansPro:bold', italic: 'SourceSansPro:italic', mono: 'SourceCodePro:regular' };
    if (/<(?:p|li)>/.test(parsed.html) && !scene.Assets?.['font:SourceSansPro:regular']) return null;
    const stacks = new Map();
    for (const p of runs) {
      const stack = fontStack(p);
      if (stacks.has(p.Font.Asset) && stacks.get(p.Font.Asset) !== stack) return null;
      stacks.set(p.Font.Asset, stack);
    }
    const needed = [...(headingSizes.length ? ['semibold'] : []), ...(/<strong>/.test(parsed.html) ? ['bold'] : []), ...(/<em>/.test(parsed.html) ? ['italic'] : []), ...(/<code>/.test(parsed.html) ? ['mono'] : [])];
    if (needed.some(role => !runs.some(p => p.Font.Asset === `font:${fonts[role]}`))) return null;
    const variables = Object.entries(fonts).map(([role, id]) => `--md-${role}:${stacks.get(`font:${id}`) ?? fontFamily(`font:${id}`)}`);
    const dx = scene.Root.Transform.E + owner.Transform.E + n.Transform.E, dy = scene.Root.Transform.F + owner.Transform.F + n.Transform.F;
    const links = (scene.Links ?? []).filter(l => parsed.links.includes(l.URL) && l.Box.X >= dx + clip[0] && l.Box.Y >= dy + clip[1] && l.Box.X + l.Box.Width <= dx + clip[2] + .001 && l.Box.Y + l.Box.Height <= dy + clip[3] + .001);
    // Preserve D2's decision to disable inline links when the whole object is linked.
    if (parsed.links.some(url => hrefOf(url) && !links.some(l => l.URL === url))) return null;
    const linked = p => links.some(l => l.Box.X < dx + p.Ink.Max.X && l.Box.X + l.Box.Width > dx + p.Ink.Min.X && l.Box.Y < dy + p.Ink.Max.Y && l.Box.Y + l.Box.Height > dy + p.Ink.Min.Y);
    const rects = children.map(c => c.Primitive).filter(p => p.$ === 'Rect' && solid(p.Fill));
    const quote = rects.find(p => p.Box.X === 0 && p.Box.Width === 4);
    const muted = runs.find(p => quote && p.Origin.X >= 20 && p.Origin.Y > quote.Box.Y && p.Origin.Y < quote.Box.Y + quote.Box.Height) ?? runs.find(p => p.Font.Asset === 'font:SourceSansPro:semibold' && p.Font.Size === 13.6);
    const foreground = runs.find(p => !linked(p) && p !== muted && p.Font.Asset.startsWith('font:SourceSansPro:')) ?? runs[0];
    for (const [role, paint] of Object.entries({ accent: runs.find(linked)?.Fill, muted: muted?.Fill, border: quote?.Fill ?? rects.find(p => p.Box.Height === 4)?.Fill, 'border-muted': rects.find(p => p.Box.Height === 1)?.Fill, code: rects.find(p => p.RadiusX === 6)?.Fill })) {
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
    const width = primBounds(n.Clip?.Path)?.[2];
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
          const matches = (scene.Links ?? []).filter(l => l.URL && ink?.Valid && Math.abs(l.Box.X - dx - ink.Min.X) < .001 && Math.abs(l.Box.Y - dy - ink.Min.Y) < .001 && Math.abs(l.Box.Width - (ink.Max.X - ink.Min.X)) < .001 && Math.abs(l.Box.Height - (ink.Max.Y - ink.Min.Y)) < .001);
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
      // No data-k=link here: mount resolves these nested hits through their object, rather than treating local coordinates as scene coordinates.
      body += `<span style="position:absolute;left:${px(l.Box.X - dx)};top:${px(l.Box.Y - dy)};width:${px(l.Box.Width)};height:${px(l.Box.Height)}"></span>`;
      // A positioned anchor at the same origin stays focusable even in browsers that cannot focus display:contents.
      return `<a${hrefOf(l.URL) ? ` href="${esc(l.URL)}"` : ''}${linkName(l) ? ` aria-label="${esc(linkName(l))}"` : ''}${l.Target ? ` data-target="${esc(l.Target)}"` : ''}${l.Tooltip ? ` title="${esc(l.Tooltip)}"` : ''} style="position:absolute;left:0;top:0;font:inherit;color:inherit;text-decoration:none">${body}</a>`;
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
    if (!table) return children.map(c => nodeHtml(c)).join('');
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
      const out = svgBox(node(n));
      inEffect = before;
      count('svg:effect-subtree-nodes');
      for (const [kind, on] of Object.entries({ mask: n.Mask, clip: n.Clip, filter: n.Filters?.length, blend: n.Blend, animation: n.Animations?.length })) if (on) count(`effect:${kind}`);
      return out;
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
      const { clip, mask } = clipMask(n, -bx, -by);
      const outer = ['position:absolute', `left:${px(bx)}`, `top:${px(by)}`, `width:${px(w)}`, `height:${px(h)}`, `transform-origin:${px(-bx)} ${px(-by)}`];
      if (!isIdentity(n.Transform)) outer.push(`transform:${matrix(n.Transform).replaceAll(' ', ',')}`);
      if (n.Opacity !== 1) outer.push(`opacity:${num(n.Opacity)}`);
      if (clip) { outer.push(`clip-path:url(#${clip})`); count('html:clipped-group'); }
      if (mask) { outer.push(`mask:url(#${mask})`); count('html:masked-group'); }
      let own = '';
      if (n.Primitive) {
        const [markup, reason] = primitiveHtml(n.Primitive, codeToken);
        if (markup === null) { own = svgBox(primitive(n.Primitive)); count(`svg:${reason}`); } else if (markup) { own = markup; count(`html:${n.Primitive.$}`); }
      }
      return `<div${n.ID ? ` data-id="${esc(n.ID)}"` : ''}${a11yAttrs(n)} style="${outer.join(';')}"><div style="position:absolute;left:${px(-bx)};top:${px(-by)}">${own}${childrenHtml(n)}</div></div>`;
    }
    if (n.Clip || n.Mask) {
      // CSS clip-path/mask by url() refer to the element's border box, so the group gets the document extent at the local origin.
      const { clip, mask } = clipMask(n);
      style.push(`width:${px(Math.max(v.X + v.Width, v.Width))}`, `height:${px(Math.max(v.Y + v.Height, v.Height))}`);
      if (clip) { style.push(`clip-path:url(#${clip})`); count('html:clipped-group'); }
      if (mask) { style.push(`mask:url(#${mask})`); count('html:masked-group'); }
    }
    let own = '';
    if (n.Primitive) {
      const [markup, reason] = primitiveHtml(n.Primitive, codeToken);
      if (markup === null) { own = svgBox(primitive(n.Primitive)); count(`svg:${reason}`); } else if (markup) { own = markup; count(`html:${n.Primitive.$}`); }
    }
    return `<div${n.ID ? ` data-id="${esc(n.ID)}"` : ''}${a11yAttrs(n)} style="${style.join(';')}">${own}${childrenHtml(n)}</div>`;
  }

  if (html) {
    const body = nodeHtml(scene.Root);
    const links = (scene.Links ?? []).filter(l => !usedLinks.has(l)).map(l => `<a data-k="link" ${hrefOf(l.URL ?? '') ? `href="${esc(l.URL)}"` : ''}${(l.URL || l.Target) && linkName(l) ? ` aria-label="${esc(linkName(l))}"` : ''}${l.Target ? ` data-target="${esc(l.Target)}"` : ''}${l.Tooltip ? ` title="${esc(l.Tooltip)}"` : ''} style="position:absolute;left:${px(l.Box.X)};top:${px(l.Box.Y)};width:${px(l.Box.Width)};height:${px(l.Box.Height)}"></a>`).join('');
    let sx = scene.LogicalWidth / v.Width, sy = scene.LogicalHeight / v.Height;
    if (scene.ViewportFit) sx = sy = Math.min(sx, sy);
    const centered = scene.ViewportFit && scene.ViewportAlign;
    const dx = centered ? (scene.LogicalWidth - v.Width * sx) / 2 : 0;
    const dy = centered ? (scene.LogicalHeight - v.Height * sy) / 2 : 0;
    return {
      html: `${flowed ? `<style>${markdownCSS}</style>` : ''}<svg width="0" height="0" style="position:absolute"><defs>${defs.join('')}</defs></svg><div data-d2-scene style="position:relative;overflow:${flowed ? 'visible' : 'hidden'};width:${px(scene.LogicalWidth)};height:${px(scene.LogicalHeight)}"><div style="position:absolute;left:0;top:0;transform-origin:0 0;transform:translate(${px(dx)},${px(dy)}) scale(${num(sx)},${num(sy)}) translate(${px(-v.X)},${px(-v.Y)})">${body}${links}</div></div>`,
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
