import { mergeVisibleAISearchTagHighlightPalette } from '../helpers/ai-search-tag-palette';
import type { FrameSyncService } from './frame-sync';
import type { SidebarStore } from '../store';
import { watch } from '../util/watch';

export function pushAiSearchTagPalette(
  frameSync: FrameSyncService,
  store: SidebarStore,
) {
  const aiSearch = store.getState().sidebarPanels.aiSearch;
  frameSync.setTagHighlightPalette(
    mergeVisibleAISearchTagHighlightPalette(
      aiSearch.rows,
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
    () => store.getState().sidebarPanels.aiSearch,
    () => {
      pushAiSearchTagPalette(frameSync, store);
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );

  pushAiSearchTagPalette(frameSync, store);
}
