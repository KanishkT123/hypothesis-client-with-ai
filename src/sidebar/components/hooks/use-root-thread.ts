import { useMemo } from 'preact/hooks';

import { currentDocumentUri, documentUriAliases } from '../../helpers/document-uri';
import { isTagInventoryRowVisibleInScope } from '../../helpers/tag-inventory-group';
import { threadAnnotations } from '../../helpers/thread-annotations';
import type {
  ThreadAnnotationsResult,
  ThreadState,
} from '../../helpers/thread-annotations';
import { useSidebarStore } from '../../store';

/**
 * Gather together state relevant to building a root thread of annotations and
 * replies and return an updated root thread when changes occur.
 */
export function useRootThread(): ThreadAnnotationsResult {
  const store = useSidebarStore();
  const annotations = store.allAnnotations();
  const query = store.filterQuery();
  const route = store.route();
  const selectionState = store.selectionState();
  const filters = store.getFilterValues();
  const showTabs = route === 'sidebar';
  const focusedGroupId = store.focusedGroupId();
  const tagInventoryRows = store.tagInventoryRows();
  const documentUri = currentDocumentUri(store);
  const uriAliases = documentUriAliases(store);

  const threadState = useMemo((): ThreadState => {
    const selection = { ...selectionState, filterQuery: query, filters };
    const hiddenTagInventoryRows = focusedGroupId
      ? tagInventoryRows
          .filter(
            row =>
              row.hidden &&
              isTagInventoryRowVisibleInScope(row, {
                focusedGroupId,
                currentDocumentUri: documentUri,
                documentUriAliases: uriAliases,
              }),
          )
          .map(row => ({
            schemaTag: row.schemaTag,
            query: row.query,
          }))
      : [];
    return {
      annotations,
      selection,
      showTabs,
      hiddenTagInventoryRows,
      documentUri,
      documentUriAliases: uriAliases,
    };
  }, [
    selectionState,
    query,
    filters,
    annotations,
    showTabs,
    focusedGroupId,
    tagInventoryRows,
    documentUri,
    uriAliases,
  ]);

  return threadAnnotations(threadState);
}
