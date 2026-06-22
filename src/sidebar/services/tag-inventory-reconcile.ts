import type { SavedAnnotation } from '../../types/api';
import { currentDocumentUri } from '../helpers/document-uri';
import { deriveTagInventoryRowDescriptors } from '../helpers/tag-inventory-group';
import { PUBLIC_GROUP_ID } from '../helpers/groups';
import { tagInventoryRowId } from '../store/modules/sidebar-panels';
import type { SidebarStore } from '../store';

export type ApplyDerivedTagInventoryRowsOptions = {
  groupId: string;
  annotations: SavedAnnotation[];
  /** Current document URI. Stored on Public group rows and included in their id. */
  documentUri?: string;
};

/**
 * Upsert inventory rows from derived descriptors.
 * For Public group rows, `documentUri` is stored on the row and included in its
 * id so that visibility is a plain URI equality check (no separate store slice).
 */
export function applyDerivedTagInventoryRows(
  store: Pick<SidebarStore, 'addTagInventoryRow'>,
  { groupId, annotations, documentUri }: ApplyDerivedTagInventoryRowsOptions,
) {
  const isPublic = groupId === PUBLIC_GROUP_ID;
  const docUri = isPublic ? documentUri : undefined;

  // Public group rows must be document-scoped. If the URI is unknown (e.g.
  // mainFrame hasn't re-registered after the sidebar opened), skip rather
  // than creating permanently-invisible rows with documentUri=''.
  if (isPublic && !docUri) {
    return;
  }

  const descriptors = deriveTagInventoryRowDescriptors(annotations);

  for (const { schemaTag, query } of descriptors) {
    store.addTagInventoryRow({
      id: tagInventoryRowId(schemaTag, query, groupId, docUri),
      groupId,
      schemaTag,
      query,
      annotationIds: [],
      ...(docUri !== undefined ? { documentUri: docUri } : {}),
    });
  }
}

/**
 * Ensure the inventory list reflects schema tags and queries on the current
 * document for the focused group. Idempotent via the upsert-by-id semantics
 * of `addTagInventoryRow`.
 */
export function reconcileTagInventoryRowsFromAnnotations(
  store: Pick<
    SidebarStore,
    | 'addTagInventoryRow'
    | 'focusedGroupId'
    | 'mainFrame'
    | 'savedAnnotations'
    | 'searchUris'
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
    documentUri: currentDocumentUri(store) ?? '',
  });
}
