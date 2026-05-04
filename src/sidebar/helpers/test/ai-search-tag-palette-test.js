import {
  INITIAL_AI_TAG_HIGHLIGHT_PALETTE,
  mergeVisibleAISearchTagHighlightPalette,
} from '../ai-search-tag-palette';

describe('sidebar/helpers/ai-search-tag-palette', () => {
  it('keeps defaults and excludes tags from hidden-only rows', () => {
    const palette = mergeVisibleAISearchTagHighlightPalette(
      [{ schemaTag: 'topic-a', hidden: true }],
      { 'topic-a': 'rgba(10, 20, 30, 0.38)' },
    );

    assert.deepEqual(palette, INITIAL_AI_TAG_HIGHLIGHT_PALETTE);
  });

  it('includes a tag color if at least one row for it is visible', () => {
    const palette = mergeVisibleAISearchTagHighlightPalette(
      [
        { schemaTag: 'topic-a', hidden: true },
        { schemaTag: 'topic-a' },
      ],
      { 'topic-a': 'rgba(10, 20, 30, 0.38)' },
    );

    assert.deepEqual(palette, {
      ...INITIAL_AI_TAG_HIGHLIGHT_PALETTE,
      'topic-a': 'rgba(10, 20, 30, 0.38)',
    });
  });

  it('drops and restores schema-tag entries when rows are hidden/unhidden', () => {
    const schemaTagColors = { topic: 'rgba(10, 20, 30, 0.38)' };

    const hiddenPalette = mergeVisibleAISearchTagHighlightPalette(
      [{ schemaTag: 'topic', hidden: true }],
      schemaTagColors,
    );
    assert.notProperty(hiddenPalette, 'topic');

    const visiblePalette = mergeVisibleAISearchTagHighlightPalette(
      [{ schemaTag: 'topic', hidden: false }],
      schemaTagColors,
    );
    assert.propertyVal(visiblePalette, 'topic', 'rgba(10, 20, 30, 0.38)');
  });
});
