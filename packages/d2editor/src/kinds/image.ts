import { leaveRows } from './shape.ts';
import type { Kind } from './types.ts';

// The icon the palette's Icon entry uses; an image needs a source, and converting to Image has none to carry.
export const PLACEHOLDER = 'https://icons.terrastruct.com/essentials/112-server.svg';

/** `shape: image`: a picture. D2 refuses children under it, so converting a node that has some removes them (the author is asked first). */
export const image: Kind = {
  id: 'image',
  label: 'Image',
  section: { id: 'image', title: 'Image', controls: [{ keyword: 'icon', title: 'Source' }] },
  detect: o => o.kind === 'shape' && o.properties.shape?.value === 'image',
  read: o => ({ text: o.label, icon: o.image?.source ?? o.properties.icon?.value }),
  write: (c, o) => [
    ...leaveRows(o),
    ...(c.children ?? []).map(child => ({ op: 'delete' as const, key: child })),
    // A block string label would keep the node a Text node, so the words become a plain label.
    { op: 'set', key: o.id, value: c.text },
    { op: 'set', key: `${o.id}.icon`, value: c.icon ?? PLACEHOLDER },
    { op: 'set', key: `${o.id}.shape`, value: 'image' },
  ],
  loss: c => (c.children?.length ? [`${c.children.length} child ${c.children.length === 1 ? 'shape' : 'shapes'}`] : []),
};
