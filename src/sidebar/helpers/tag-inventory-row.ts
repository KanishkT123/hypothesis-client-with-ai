import type { SidebarStore } from '../store';
import type { TagInventoryRow } from '../store/modules/sidebar-panels';

function norm(value: string): string {
  return value.trim();
}

export function findTagInventoryRowByTagQuery(
  rows: TagInventoryRow[],
  schemaTag: string,
  query: string,
  groupId?: string,
): TagInventoryRow | undefined {
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
 * Keep a single tag inventory row for a group/tag/query triple.
 * If an equivalent row already exists, merge duplicates into it.
 * Otherwise create one and immediately merge duplicates.
 */
export function ensureTagInventoryRowForTagQuery(
  store: Pick<
    SidebarStore,
    'addTagInventoryRow' | 'tagInventoryRows' | 'mergeTagInventoryRowsWithSameTagQuery'
  >,
  row: TagInventoryRow,
): string {
  const match = findTagInventoryRowByTagQuery(
    store.tagInventoryRows(),
    row.schemaTag,
    row.query,
    row.groupId,
  );

  if (match) {
    store.mergeTagInventoryRowsWithSameTagQuery(match.id);
    return match.id;
  }

  store.addTagInventoryRow(row);
  store.mergeTagInventoryRowsWithSameTagQuery(row.id);
  return row.id;
}
