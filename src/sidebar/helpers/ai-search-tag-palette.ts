/**
 * Default tag → highlight map for AI flows; merged with per–schema-tag colors from Redux.
 */
export const INITIAL_AI_TAG_HIGHLIGHT_PALETTE: Record<string, string> = {
  ai: 'rgba(64, 169, 255, 0.38)',
};

export function mergeAISearchTagHighlightPalette(
  schemaTagColors: Record<string, string>,
): Record<string, string> {
  return { ...INITIAL_AI_TAG_HIGHLIGHT_PALETTE, ...schemaTagColors };
}
