// Feature map rule (user, 31 Oct 2026): D2 should feel natural on the web, not look like native SVG. Each family names the web element or behaviour
// that is natural for it (the target, not always today's painter), and `byDesign` lists cases where native's static artefact is deliberately not
// reproduced, so a pixel difference there is not a gap. Accepted in docs/adr/0009; the pixel bar only applies where the web has no other natural form.
export const webForms = {
  shape: 'SVG geometry for outlines; HTML or SVG text for labels',
  style: 'SVG paint (fill, stroke, filter); CSS for opacity and font properties',
  arrowhead: 'SVG markers or paths on the connection',
  connection: 'SVG path per edge; label as text positioned on it',
  container: 'Nesting as grouping (`role=group`), flat geometry from D2',
  'label-position': 'Positioned text, computed by D2 layout',
  'icon-position': 'Element `img` (or inline SVG) positioned by D2 layout',
  near: 'Positioned text',
  tooltip: 'Hover shows the browser\'s `title`; keyboard focus on the object (or its link) shows a `role=tooltip` element holding the D2 tooltip text (spec 0009 stage C). Never an always-visible badge',
  direction: 'Layout only',
  'layout-engine': 'Layout only',
  grid: 'Geometry from D2 layout',
  size: 'Geometry from D2 layout',
  sequence: 'SVG geometry; actors and notes as text',
  content: 'Markdown as HTML text, code as `pre`/`code`, links as `a`, tooltips as hover popovers showing the D2 tooltip text, icons as `img`',
  language: 'Compile-time only, nothing to paint',
  board: 'One scene per board; navigation is consumer UI',
  theme: 'Colours from D2; light and dark are two requests (a `prefers-color-scheme` switch is the consumer\'s)',
  sketch: 'SVG paths from D2 (hand-drawn look is D2\'s, not a browser feature)',
  render: 'Host sizing and scaling (`transform`)',
  config: 'Compile-time only',
  color: 'SVG paint servers (gradients) and CSS colours, values from D2',
  table: 'SVG geometry from D2; positioned rows and cells exposed through ARIA table roles (spec 0009)',
  effects: 'SVG paint (filter, stroke-dasharray) and CSS opacity',
  unicode: 'Text with the consumer\'s web fonts; bidi and shaping by the browser, advances and line breaks from D2',
  animation: 'Web Animations on the painted element (timing from D2); pausing or reduced-motion handling belongs to the consumer, not to d2web (spec 0005)',
};

// Native paints something static here that the web does as behaviour. These are not gaps; test the behaviour instead.
export const byDesign = [
  { match: /^content\/(link|tooltip)/, text: 'Native adds a corner badge and canvas room per link or tooltip. On the web a link is an anchor and a tooltip appears on hover or focus; no badge is painted and the smaller canvas is correct.' },
  { match: /^shape\/text$/, text: 'Native embeds a subset font without GPOS kerning; the web draws the scene\'s full font and the browser applies kerning, as it does for any web text. The line is 0.7 px wider in native layout terms and the glyphs drift apart by up to a pixel; same text, same font, web typography.' },
  { match: /^content\/icon-remote$/, text: 'By default D2 compiles offline in the worker, so a remote icon URL paints the builder\'s placeholder (this measurement). With the client `images` option (spec 0010, ADR 0011) the page supplies the bytes (`bundle`, native\'s default SVG behaviour) or keeps the link (`link`, `--bundle=false`); supplied bytes match native exactly (the 35 inlined icon cases). The case itself was not re-measured with `images` set.' },
];
