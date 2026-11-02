import type { Association, AssociationObject, CompileResult } from './protocol.ts';
import type { Box, LinkRegion, SceneDocument, SceneNode } from './scene.ts';
import { linkOwners } from './geometry.ts';

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

// Hand-built boards without D2's `box`: rectangles and ellipses are exact; a path outline has no box.
function objectBounds(node: SceneNode | undefined): Box | undefined {
  const p = node?.Children?.find(c => c.Primitive && ['Rect', 'Ellipse', 'Path'].includes(c.Primitive.$))?.Primitive ?? node?.Primitive;
  if (!node || !p) return undefined;
  const [dx, dy] = [node.Transform?.E ?? 0, node.Transform?.F ?? 0];
  if (p.$ === 'Rect') return { X: p.Box.X + dx, Y: p.Box.Y + dy, Width: p.Box.Width, Height: p.Box.Height };
  if (p.$ === 'Ellipse') return { X: p.Center.X - p.RadiusX + dx, Y: p.Center.Y - p.RadiusY + dy, Width: 2 * p.RadiusX, Height: 2 * p.RadiusY };
  return undefined;
}

export function prepareBoard(result: CompileResult, path = ''): RenderBoard {
  if (result.error) throw new Error(`result has an error: ${result.error.message}`);
  const board = result.boards?.find(b => b.path === path);
  if (!board) throw new Error(`result has no board "${path}"`);
  if (!board.scene?.Root || !board.scene.ViewBox) throw new Error('scene needs Root and ViewBox');
  const association = board.association ?? { objects: [] };
  const objects = association.objects.map(o => ({ ...o, bounds: o.box ?? objectBounds(board.scene.Root.Children?.find(n => n.ID === o.id)) }));
  const owners = linkOwners(board.scene, association);
  const links = (board.scene.Links ?? []).map((region, i) => ({ region, ...(owners[i] ? { objectId: owners[i] } : {}) }));
  return { revision: result.revision, path, scene: board.scene, association, fonts: result.fonts ?? {}, objects, links };
}
