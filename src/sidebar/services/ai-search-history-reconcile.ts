import type { SavedAnnotation } from '../../types/api';
import { ensureAISearchHistoryRowForTagQuery } from '../helpers/ai-search-history-row';
import { aiSearchContentTags } from '../helpers/claude-ai-search-user-message';
import type { SidebarStore } from '../store';

const LOAD_SYNC_ROW_PREFIX = 'load-sync';

function normalizedSchemaTagsFromAnnotations(
  annotations: SavedAnnotation[],
): string[] {
  const uniqueTags = new Set<string>();

  for (const annotation of annotations) {
    const tags = aiSearchContentTags(annotation.tags ?? []);
    for (const tag of tags) {
      const trimmed = tag.trim();
      if (trimmed) {
        uniqueTags.add(trimmed);
      }
    }
  }

  return [...uniqueTags];
}

function loadSyncRowID(schemaTag: string): string {
  return `${LOAD_SYNC_ROW_PREFIX}-${encodeURIComponent(schemaTag)}`;
}

/**
 * Ensure the history list has one empty-query row for each discovered tag.
 * Calls are idempotent because row matching/deduplication is centralized in
 * `ensureAISearchHistoryRowForTagQuery`.
 */
export function reconcileAISearchHistoryRowsFromAnnotations(
  store: Pick<
    SidebarStore,
    | 'addAISearchRow'
    | 'aiSearchRows'
    | 'mergeAISearchRowsWithSameTagQuery'
    | 'savedAnnotations'
  >,
) {
  const schemaTags = normalizedSchemaTagsFromAnnotations(store.savedAnnotations());
  for (const schemaTag of schemaTags) {
    ensureAISearchHistoryRowForTagQuery(store, {
      id: loadSyncRowID(schemaTag),
      schemaTag,
      query: '',
      annotationIds: [],
    });
  }
}
