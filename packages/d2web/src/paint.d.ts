import type { SceneDocument } from './scene.js';

export interface AnimationSpec { target: 'node' | 'primitive'; keyframes: Record<string, string | number>[]; options: { delay: number; duration: number; iterations: number; fill: 'both' } }
export function fontFamily(assetId: string): string;
export function paintScene(
  scene: SceneDocument,
  options?: { html?: boolean; cssMasks?: boolean | 'subtree'; idPrefix?: string; a11y?: boolean; flow?: boolean; association?: { id: string; kind: string; label?: string; content?: string; parent?: string; image?: { source: string; role: string; node: string } }[] },
): { html: string; svg: string; stats: Record<string, number>; animated: boolean; animations: AnimationSpec[][] };
