export function fontFamily(assetId: string): string;
export function paintScene(
  scene: unknown,
  options?: { html?: boolean; cssMasks?: boolean | 'subtree'; idPrefix?: string; a11y?: boolean },
): { html: string; svg: string; stats: Record<string, number>; animated: boolean };
