import type { SidebarStore } from '../store';
import type { AISearchRow } from '../store/modules/sidebar-panels';

function norm(value: string): string {
  return value.trim();
}

export function findAISearchRowByTagQuery(
  rows: AISearchRow[],
  schemaTag: string,
  query: string,
  groupId?: string,
): AISearchRow | undefined {
  const tagKey = norm(schemaTag);
  const queryKey = norm(query);
  return rows.find(row => {
    if (norm(row.schemaTag) !== tagKey || norm(row.query) !== queryKey) {
      return false;
    }
    if (groupId !== undefined && row.groupId !== groupId) {
      return false;
    }
    return true;
  });
}

/**
 * Keep a single AI search row for a group/tag/query triple.
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
    row.groupId,
  );

  if (match) {
    store.mergeAISearchRowsWithSameTagQuery(match.id);
    return match.id;
  }

  store.addAISearchRow(row);
  store.mergeAISearchRowsWithSameTagQuery(row.id);
  return row.id;
}
