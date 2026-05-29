import { useMemo } from 'preact/hooks';

import { isAISearchRowVisibleInScope } from '../../helpers/ai-search-group-history';
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
  const aiSearchRows = store.aiSearchRows();
  const publicScope = store.aiSearchPublicDocumentScope();
  const publicDocumentDescriptorKeys = useMemo(
    () =>
      publicScope?.visibleDescriptorKeys
        ? new Set(publicScope.visibleDescriptorKeys)
        : null,
    [publicScope],
  );
  const documentUri =
    store.mainFrame()?.uri ?? store.searchUris()[0] ?? null;

  const threadState = useMemo((): ThreadState => {
    const selection = { ...selectionState, filterQuery: query, filters };
    const hiddenAISearchRows = focusedGroupId
      ? aiSearchRows
          .filter(
            row =>
              row.hidden &&
              isAISearchRowVisibleInScope(row, {
                focusedGroupId,
                publicDocumentDescriptorKeys,
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
      hiddenAISearchRows,
      documentUri,
    };
  }, [
    selectionState,
    query,
    filters,
    annotations,
    showTabs,
    focusedGroupId,
    aiSearchRows,
    publicDocumentDescriptorKeys,
    documentUri,
  ]);

  return threadAnnotations(threadState);
}
