export interface AnimationSpec { target: 'node' | 'primitive'; keyframes: Record<string, string | number>[]; options: { delay: number; duration: number; iterations: number; fill: 'both' } }
export function fontFamily(assetId: string): string;
export function paintScene(
  scene: unknown,
  options?: { html?: boolean; cssMasks?: boolean | 'subtree'; idPrefix?: string; a11y?: boolean; association?: { id: string; kind: string; label?: string; content?: string; parent?: string }[] },
): { html: string; svg: string; stats: Record<string, number>; animated: boolean; animations: AnimationSpec[][] };
