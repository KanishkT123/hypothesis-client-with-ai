import type { SavedAnnotation } from '../../types/api';
import { resolveDocumentUriFromCandidates } from '../helpers/document-uri';
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
 * Assign `documentUri` to legacy Public rows that predate document-scoped ids.
 * Re-keys rows via upsert + removes the old id when it changes.
 */
export function backfillPublicTagInventoryDocumentUris(
  store: Pick<
    SidebarStore,
    | 'addTagInventoryRow'
    | 'removeTagInventoryRow'
    | 'tagInventoryRows'
    | 'mainFrame'
    | 'defaultContentFrame'
    | 'searchUris'
  >,
) {
  const documentUri = resolveDocumentUriFromCandidates(store);
  if (!documentUri) {
    return;
  }

  for (const row of store.tagInventoryRows()) {
    if (row.groupId !== PUBLIC_GROUP_ID || row.documentUri) {
      continue;
    }
    const migratedId = tagInventoryRowId(
      row.schemaTag,
      row.query,
      row.groupId,
      documentUri,
    );
    store.addTagInventoryRow({
      ...row,
      id: migratedId,
      documentUri,
    });
    if (row.id !== migratedId) {
      store.removeTagInventoryRow(row.id);
    }
  }
}
