import { currentDocumentUri, documentUriAliases } from '../helpers/document-uri';
import { isTagInventoryRowVisibleInScope } from '../helpers/tag-inventory-group';
import { mergeVisibleTagHighlightPalette } from '../helpers/tag-palette';
import type { TagInventoryRow } from '../store/modules/sidebar-panels';
import type { FrameSyncService } from './frame-sync';
import type { SidebarStore } from '../store';
import { watch } from '../util/watch';

export function pushTagPalette(
  frameSync: FrameSyncService,
  store: SidebarStore,
) {
  const tagInventory = store.getState().sidebarPanels.tagInventory;
  const focusedGroupId = store.focusedGroupId();
  const docUri = currentDocumentUri(store);
  const uriAliases = documentUriAliases(store);

  // Only the focused group's visible rows contribute highlight colors, so the
  // PDF palette matches the (group-scoped) inventory table.
  const visibleRows = focusedGroupId
    ? (tagInventory.rows as TagInventoryRow[]).filter((row: TagInventoryRow) =>
        isTagInventoryRowVisibleInScope(row, {
          focusedGroupId,
          currentDocumentUri: docUri,
          documentUriAliases: uriAliases,
        }),
      )
    : [];

  const hiddenAnnotationIds = (tagInventory.rows as TagInventoryRow[])
    .filter(row => row.hidden === true)
    .flatMap(row => row.annotationIds);

  frameSync.setTagHighlightPalette(
    mergeVisibleTagHighlightPalette(
      visibleRows,
      tagInventory.schemaTagColors,
    ),
    hiddenAnnotationIds,
  );
}

export function setupTagPaletteSync(
  frameSync: FrameSyncService,
  store: SidebarStore,
) {
  watch(
    store.subscribe,
    () =>
      [
        store.getState().sidebarPanels.tagInventory,
        store.focusedGroupId(),
        currentDocumentUri(store),
        documentUriAliases(store),
      ] as const,
    () => {
      pushTagPalette(frameSync, store);
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );

  pushTagPalette(frameSync, store);
}
