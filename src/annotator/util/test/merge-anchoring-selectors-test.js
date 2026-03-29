import {
  isQuoteOnlySelectors,
  mergeAnchoringSelectors,
} from '../merge-anchoring-selectors';

describe('annotator/util/merge-anchoring-selectors', () => {
  describe('isQuoteOnlySelectors', () => {
    it('returns false for undefined or empty', () => {
      assert.isFalse(isQuoteOnlySelectors(undefined));
      assert.isFalse(isQuoteOnlySelectors([]));
    });

    it('returns true when every selector is TextQuoteSelector', () => {
      assert.isTrue(
        isQuoteOnlySelectors([
          { type: 'TextQuoteSelector', exact: 'a' },
        ]),
      );
    });

    it('returns false when any selector is not TextQuoteSelector', () => {
      assert.isFalse(
        isQuoteOnlySelectors([
          { type: 'TextQuoteSelector', exact: 'a' },
          { type: 'TextPositionSelector', start: 0, end: 1 },
        ]),
      );
    });
  });

  describe('mergeAnchoringSelectors', () => {
    const quote = { type: 'TextQuoteSelector', exact: 'hello' };
    const pos = { type: 'TextPositionSelector', start: 1, end: 5 };
    const page = { type: 'PageSelector', index: 0 };

    it('adds TextPositionSelector and PageSelector when missing', () => {
      const out = mergeAnchoringSelectors([quote], [pos, quote, page]);
      assert.deepEqual(out, [quote, pos, page]);
    });

    it('does not add a second TextQuoteSelector from fromDescribe', () => {
      const out = mergeAnchoringSelectors([quote], [quote, pos, page]);
      assert.equal(
        out.filter(s => s.type === 'TextQuoteSelector').length,
        1,
      );
    });

    it('does not duplicate position or page if already present', () => {
      const out = mergeAnchoringSelectors([quote, pos, page], [pos, page]);
      assert.equal(out.length, 3);
    });
  });
});
