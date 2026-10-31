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
  tooltip: 'Hover and focus popover (`title` today; any other element is still only the D2 tooltip text, with no behaviour of our own), never an always-visible badge',
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
  animation: 'CSS or SMIL animation on the painted path, honouring `prefers-reduced-motion`',
};

// Native paints something static here that the web does as behaviour. These are not gaps; test the behaviour instead.
export const byDesign = [
  { match: /^content\/(link|tooltip)/, text: 'Native adds a corner badge and canvas room per link or tooltip. On the web a link is an anchor and a tooltip appears on hover or focus; no badge is painted and the smaller canvas is correct.' },
];
