import type { Selector } from '../../types/api';

/**
 * True when the selector list is non-empty and every entry is a TextQuoteSelector
 * (no position, page, range, shape, etc.).
 */
export function isQuoteOnlySelectors(
  selectors: Selector[] | undefined,
): boolean {
  return (
    !!selectors &&
    selectors.length > 0 &&
    selectors.every(s => s.type === 'TextQuoteSelector')
  );
}

/**
 * Merge selectors produced by Integration.describe into an existing list.
 * Keeps the API's original quote; adds TextPositionSelector and PageSelector
 * from `fromDescribe` when missing. Ignores extra TextQuoteSelector entries
 * from `fromDescribe` so the stored quote stays stable.
 */
export function mergeAnchoringSelectors(
  existing: Selector[],
  fromDescribe: Selector[],
): Selector[] {
  const out = [...existing];
  const hasType = (t: Selector['type']) => out.some(s => s.type === t);

  for (const sel of fromDescribe) {
    if (sel.type === 'TextQuoteSelector') {
      continue;
    }
    if (sel.type === 'TextPositionSelector' && !hasType('TextPositionSelector')) {
      out.push(sel);
    } else if (sel.type === 'PageSelector' && !hasType('PageSelector')) {
      out.push(sel);
    }
  }

  return out;
}
