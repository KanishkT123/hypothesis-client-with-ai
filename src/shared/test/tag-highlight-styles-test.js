import { applyTagHighlightPalette } from '../tag-highlight-styles';

describe('shared/tag-highlight-styles', () => {
  function getDynamicStyle(doc = document) {
    return doc.getElementById('hypothesis-dynamic-tag-highlight-rules');
  }

  afterEach(() => {
    getDynamicStyle()?.remove();
  });

  it('injects legacy and overlay rules for each palette tag', () => {
    applyTagHighlightPalette(document, {
      TopicA: 'rgba(1, 2, 3, 0.38)',
      'topic-b': 'rgba(4, 5, 6, 0.38)',
    });

    const style = getDynamicStyle();
    assert.ok(style);
    assert.include(
      style.textContent,
      '.hypothesis-highlights-always-on .hypothesis-highlight.h-tag-topica',
    );
    assert.include(
      style.textContent,
      '.hypothesis-highlights-always-on .hypothesis-svg-highlight-overlay.h-tag-topica',
    );
    assert.include(
      style.textContent,
      '.hypothesis-highlights-always-on .hypothesis-svg-highlight-overlay.h-tag-topic-b',
    );
  });

  it('skips empty tags and colors', () => {
    applyTagHighlightPalette(document, {
      '': 'rgba(1, 2, 3, 0.38)',
      valid: '',
      okay: 'rgba(1, 2, 3, 0.38)',
    });

    const style = getDynamicStyle();
    assert.ok(style);
    assert.notInclude(style.textContent, '.h-tag-valid');
    assert.include(style.textContent, 'h-tag-okay');
  });
});
