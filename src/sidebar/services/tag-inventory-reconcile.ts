import type { SavedAnnotation } from '../../types/api';
import {
  deriveTagInventoryRowDescriptors,
  rowDescriptorKey,
} from '../helpers/tag-inventory-group';
import { PUBLIC_GROUP_ID } from '../helpers/groups';
import { ensureTagInventoryRowForTagQuery } from '../helpers/tag-inventory-row';
import type { SidebarStore } from '../store';

const LOAD_SYNC_ROW_PREFIX = 'load-sync';

export function loadSyncRowID(schemaTag: string, query: string): string {
  return `${LOAD_SYNC_ROW_PREFIX}-${encodeURIComponent(
    rowDescriptorKey(schemaTag, query),
  )}`;
}

export type ApplyDerivedTagInventoryRowsOptions = {
  groupId: string;
  annotations: SavedAnnotation[];
  /** When true, update Public document visibility keys from derived descriptors. */
  updatePublicScope?: boolean;
  documentUri?: string;
};

/**
 * Upsert inventory rows from derived descriptors and optionally refresh Public
 * document scope keys.
 */
export function applyDerivedTagInventoryRows(
  store: Pick<
    SidebarStore,
    | 'addTagInventoryRow'
    | 'tagInventoryRows'
    | 'mergeTagInventoryRowsWithSameTagQuery'
    | 'setTagInventoryPublicDocumentScope'
  >,
  { groupId, annotations, updatePublicScope, documentUri }: ApplyDerivedTagInventoryRowsOptions,
) {
  const descriptors = deriveTagInventoryRowDescriptors(annotations);

  for (const { schemaTag, query } of descriptors) {
    ensureTagInventoryRowForTagQuery(store, {
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
    store.setTagInventoryPublicDocumentScope({
      documentUri,
      visibleDescriptorKeys: descriptors.map(d =>
        rowDescriptorKey(d.schemaTag, d.query),
      ),
    });
  }
}

/**
 * Ensure the inventory list reflects schema tags and queries on the current
 * document for the focused group. Idempotent via `ensureTagInventoryRowForTagQuery`.
 */
export function reconcileTagInventoryRowsFromAnnotations(
  store: Pick<
    SidebarStore,
    | 'addTagInventoryRow'
    | 'tagInventoryRows'
    | 'focusedGroupId'
    | 'mainFrame'
    | 'mergeTagInventoryRowsWithSameTagQuery'
    | 'savedAnnotations'
    | 'searchUris'
    | 'setTagInventoryPublicDocumentScope'
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

  applyDerivedTagInventoryRows(store, {
    groupId,
    annotations,
    updatePublicScope: groupId === PUBLIC_GROUP_ID,
    documentUri: store.mainFrame()?.uri ?? '',
  });
}
