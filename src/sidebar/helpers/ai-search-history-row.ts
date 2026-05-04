import type { SidebarStore } from '../store';
import type { AISearchRow } from '../store/modules/sidebar-panels';

function norm(value: string): string {
  return value.trim();
}

export function findAISearchRowByTagQuery(
  rows: AISearchRow[],
  schemaTag: string,
  query: string,
): AISearchRow | undefined {
  const tagKey = norm(schemaTag);
  const queryKey = norm(query);
  return rows.find(
    row => norm(row.schemaTag) === tagKey && norm(row.query) === queryKey,
  );
}

/**
 * Keep a single AI search row for a tag/query pair.
 * If an equivalent row already exists, merge duplicates into it.
 * Otherwise create one and immediately merge duplicates.
 */
export function ensureAISearchHistoryRowForTagQuery(
  store: Pick<
    SidebarStore,
    'addAISearchRow' | 'aiSearchRows' | 'mergeAISearchRowsWithSameTagQuery'
  >,
  row: AISearchRow,
): string {
  const match = findAISearchRowByTagQuery(
    store.aiSearchRows(),
    row.schemaTag,
    row.query,
  );

  if (match) {
    store.mergeAISearchRowsWithSameTagQuery(match.id);
    return match.id;
  }

  store.addAISearchRow(row);
  store.mergeAISearchRowsWithSameTagQuery(row.id);
  return row.id;
}
