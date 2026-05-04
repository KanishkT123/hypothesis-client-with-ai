/**
 * Default tag → highlight map for AI flows; merged with per–schema-tag colors from Redux.
 */
export const INITIAL_AI_TAG_HIGHLIGHT_PALETTE: Record<string, string> = {
  'ai-pending': 'rgba(64, 169, 255, 0.38)',
  'ai-user-approved': 'rgba(255, 64, 223, 0.38)',
};

export function mergeAISearchTagHighlightPalette(
  schemaTagColors: Record<string, string>,
): Record<string, string> {
  return { ...INITIAL_AI_TAG_HIGHLIGHT_PALETTE, ...schemaTagColors };
}

type AISearchPaletteRow = {
  schemaTag: string;
  hidden?: boolean;
};

/**
 * Merge defaults with tag colors for schema tags that appear in at least one
 * visible (non-hidden) AI search history row.
 */
export function mergeVisibleAISearchTagHighlightPalette(
  rows: AISearchPaletteRow[],
  schemaTagColors: Record<string, string>,
): Record<string, string> {
  const visibleTags = new Set(
    rows
      .filter(row => row.hidden !== true)
      .map(row => row.schemaTag.trim())
      .filter(tag => tag.length > 0),
  );

  const visibleSchemaTagColors = Object.fromEntries(
    Object.entries(schemaTagColors).filter(([tag]) => visibleTags.has(tag.trim())),
  );

  return mergeAISearchTagHighlightPalette(visibleSchemaTagColors);
}
