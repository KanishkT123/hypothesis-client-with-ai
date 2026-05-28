import type { SavedAnnotation } from '../../types/api';
import {
  deriveAISearchHistoryRowDescriptors,
  rowDescriptorKey,
} from '../helpers/ai-search-group-history';
import { PUBLIC_GROUP_ID } from '../helpers/groups';
import { ensureAISearchHistoryRowForTagQuery } from '../helpers/ai-search-history-row';
import type { SidebarStore } from '../store';

const LOAD_SYNC_ROW_PREFIX = 'load-sync';

export function loadSyncRowID(schemaTag: string, query: string): string {
  return `${LOAD_SYNC_ROW_PREFIX}-${encodeURIComponent(
    rowDescriptorKey(schemaTag, query),
  )}`;
}

export type ApplyDerivedAISearchHistoryRowsOptions = {
  groupId: string;
  annotations: SavedAnnotation[];
  /** When true, update Public document visibility keys from derived descriptors. */
  updatePublicScope?: boolean;
  documentUri?: string;
};

/**
 * Upsert history rows from derived descriptors and optionally refresh Public
 * document scope keys.
 */
export function applyDerivedAISearchHistoryRows(
  store: Pick<
    SidebarStore,
    | 'addAISearchRow'
    | 'aiSearchRows'
    | 'mergeAISearchRowsWithSameTagQuery'
    | 'setAISearchPublicDocumentScope'
  >,
  { groupId, annotations, updatePublicScope, documentUri }: ApplyDerivedAISearchHistoryRowsOptions,
) {
  const descriptors = deriveAISearchHistoryRowDescriptors(annotations);

  for (const { schemaTag, query } of descriptors) {
    ensureAISearchHistoryRowForTagQuery(store, {
      id: loadSyncRowID(schemaTag, query),
      groupId,
      schemaTag,
      query,
      annotationIds: [],
    });
  }

  if (
    updatePublicScope &&
    groupId === PUBLIC_GROUP_ID &&
    documentUri !== undefined
  ) {
    store.setAISearchPublicDocumentScope({
      documentUri,
      visibleDescriptorKeys: descriptors.map(d =>
        rowDescriptorKey(d.schemaTag, d.query),
      ),
    });
  }
}

/**
 * Ensure the history list reflects schema tags and queries on the current
 * document for the focused group. Idempotent via `ensureAISearchHistoryRowForTagQuery`.
 */
export function reconcileAISearchHistoryRowsFromAnnotations(
  store: Pick<
    SidebarStore,
    | 'addAISearchRow'
    | 'aiSearchRows'
    | 'focusedGroupId'
    | 'mainFrame'
    | 'mergeAISearchRowsWithSameTagQuery'
    | 'savedAnnotations'
    | 'searchUris'
    | 'setAISearchPublicDocumentScope'
  >,
) {
  const groupId = store.focusedGroupId();
  if (!groupId) {
    return;
  }

  const uriSet = new Set(store.searchUris());
  const annotations = store.savedAnnotations().filter(
    ann => ann.group === groupId && uriSet.has(ann.uri),
  );

  applyDerivedAISearchHistoryRows(store, {
    groupId,
    annotations,
    updatePublicScope: groupId === PUBLIC_GROUP_ID,
    documentUri: store.mainFrame()?.uri ?? '',
  });
}
