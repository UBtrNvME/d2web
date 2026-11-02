import type { Association, AssociationObject, CompileResult } from './protocol.ts';
import type { Box, LinkRegion, SceneDocument, SceneNode } from './scene.ts';
import { objectForLink } from './geometry.ts';

export type RenderObject = Readonly<AssociationObject & { bounds?: Box }>;
export type RenderLink = Readonly<{ region: LinkRegion; objectId?: string }>;
// Borrowed D2 data, treated as immutable by renderers. No DOM, CSS selectors, resource loading or layout policy.
export interface RenderBoard {
  readonly revision: number;
  readonly path: string;
  readonly scene: SceneDocument;
  readonly association: Association;
  readonly fonts: NonNullable<CompileResult['fonts']>;
  readonly objects: readonly RenderObject[];
  readonly links: readonly RenderLink[];
}

// shortcut: nodeBox uses outline control points and translation; exact ink/general affine bounds need a separate tested contract.
function objectBounds(node: SceneNode | undefined): Box | undefined {
  const p = node?.Children?.find(c => c.Primitive && ['Rect', 'Ellipse', 'Path'].includes(c.Primitive.$))?.Primitive ?? node?.Primitive;
  if (!node || !p) return undefined;
  const [dx, dy] = [node.Transform?.E ?? 0, node.Transform?.F ?? 0];
  if (p.$ === 'Rect') return { X: p.Box.X + dx, Y: p.Box.Y + dy, Width: p.Box.Width, Height: p.Box.Height };
  if (p.$ === 'Ellipse') return { X: p.Center.X - p.RadiusX + dx, Y: p.Center.Y - p.RadiusY + dy, Width: 2 * p.RadiusX, Height: 2 * p.RadiusY };
  if (p.$ !== 'Path') return undefined;
  const points = p.Commands.flatMap(c => c.Kind === 5 ? [] : c.Kind === 2 ? [c.P1, c.P2] : c.Kind === 3 ? [c.P1, c.P2, c.P3] : [c.P1]);
  if (!points.length) return undefined;
  const [x0, x1] = [Math.min(...points.map(p => p.X)), Math.max(...points.map(p => p.X))];
  const [y0, y1] = [Math.min(...points.map(p => p.Y)), Math.max(...points.map(p => p.Y))];
  return { X: x0 + dx, Y: y0 + dy, Width: x1 - x0, Height: y1 - y0 };
}

export function prepareBoard(result: CompileResult, path = ''): RenderBoard {
  if (result.error) throw new Error(`result has an error: ${result.error.message}`);
  const board = result.boards?.find(b => b.path === path);
  if (!board) throw new Error(`result has no board "${path}"`);
  if (!board.scene?.Root || !board.scene.ViewBox) throw new Error('scene needs Root and ViewBox');
  const association = board.association ?? { objects: [] };
  const objects = association.objects.map(o => ({ ...o, bounds: objectBounds(board.scene.Root.Children?.find(n => n.ID === o.id)) }));
  const links = (board.scene.Links ?? []).map(region => {
    const owner = objectForLink(board.scene, region);
    return { region, ...(owner ? { objectId: owner.ID } : {}) };
  });
  return { revision: result.revision, path, scene: board.scene, association, fonts: result.fonts ?? {}, objects, links };
}
