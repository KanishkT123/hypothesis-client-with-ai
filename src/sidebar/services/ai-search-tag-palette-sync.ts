import { isAISearchRowVisibleInScope } from '../helpers/ai-search-group-history';
import { mergeVisibleAISearchTagHighlightPalette } from '../helpers/ai-search-tag-palette';
import type { AISearchRow } from '../store/modules/sidebar-panels';
import type { FrameSyncService } from './frame-sync';
import type { SidebarStore } from '../store';
import { watch } from '../util/watch';

export function pushAiSearchTagPalette(
  frameSync: FrameSyncService,
  store: SidebarStore,
) {
  const aiSearch = store.getState().sidebarPanels.aiSearch;
  const focusedGroupId = store.focusedGroupId();
  const publicScope = store.aiSearchPublicDocumentScope();
  const publicDocumentDescriptorKeys = publicScope
    ? new Set(publicScope.visibleDescriptorKeys)
    : null;

  // Only the focused group's visible rows contribute highlight colors, so the
  // PDF palette matches the (group-scoped) history table.
  const visibleRows = focusedGroupId
    ? (aiSearch.rows as AISearchRow[]).filter((row: AISearchRow) =>
        isAISearchRowVisibleInScope(row, {
          focusedGroupId,
          publicDocumentDescriptorKeys,
        }),
      )
    : [];

  frameSync.setTagHighlightPalette(
    mergeVisibleAISearchTagHighlightPalette(
      visibleRows,
      aiSearch.schemaTagColors,
    ),
  );
}

export function setupAISearchTagPaletteSync(
  frameSync: FrameSyncService,
  store: SidebarStore,
) {
  watch(
    store.subscribe,
    () =>
      [
        store.getState().sidebarPanels.aiSearch,
        store.focusedGroupId(),
        store.aiSearchPublicDocumentScope(),
      ] as const,
    () => {
      pushAiSearchTagPalette(frameSync, store);
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );

  pushAiSearchTagPalette(frameSync, store);
}
