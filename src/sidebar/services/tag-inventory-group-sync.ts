import type { Annotation, SavedAnnotation } from '../../types/api';
import { isSaved } from '../helpers/annotation-metadata';
import { currentDocumentUri } from '../helpers/document-uri';
import {
  deriveTagInventoryRowDescriptors,
} from '../helpers/tag-inventory-group';
import { PUBLIC_GROUP_ID } from '../helpers/groups';
import type { SidebarStore } from '../store';
import { watch } from '../util/watch';
import type { APIService } from './api';
import { applyDerivedTagInventoryRows } from './tag-inventory-reconcile';

type FocusedGroupWatchValue = readonly [boolean, string | null];

/** Compare profile + group watch values without relying on array reference equality. */
function focusedGroupWatchValuesEqual(
  current: FocusedGroupWatchValue,
  previous: FocusedGroupWatchValue,
): boolean {
  return current[0] === previous[0] && current[1] === previous[1];
}

/** Max page size accepted by `GET /api/groups/{id}/annotations`. */
const GROUP_ANNOTATIONS_PAGE_SIZE = 100;

/** Hard cap on pages to guard against a non-advancing cursor. */
const MAX_GROUP_ANNOTATION_PAGES = 1000;

export type SyncGroupInventoryOptions = {
  documentUris?: string[];
};

function filterAnnotationsForDocumentScope(
  annotations: SavedAnnotation[],
  groupId: string,
  documentUris: string[],
): SavedAnnotation[] {
  const uriSet = new Set(documentUris);
  return annotations.filter(
    ann => ann.group === groupId && uriSet.has(ann.uri),
  );
}

/** Saved annotations on the current document for Public-group few-shot examples. */
export function savedAnnotationsForCurrentDocument(
  savedAnnotations: SavedAnnotation[],
  groupId: string,
  documentUris: string[],
): SavedAnnotation[] {
  return filterAnnotationsForDocumentScope(
    savedAnnotations,
    groupId,
    documentUris,
  );
}

/**
 * Fetch every annotation in a group via `GET /api/groups/{id}/annotations`.
 *
 * This endpoint paginates with `page[after]` (a date-time cursor, "older than
 * this date") + `page[size]` and returns `{ meta, data }`, so it cannot reuse
 * `SearchClient` (which expects the `/api/search` `{ rows, total }` shape).
 */
async function fetchAllGroupAnnotations(
  api: APIService,
  groupId: string,
  signal: AbortSignal,
): Promise<SavedAnnotation[]> {
  const annotations: SavedAnnotation[] = [];
  let pageAfter: string | undefined;

  for (let page = 0; page < MAX_GROUP_ANNOTATION_PAGES; page++) {
    if (signal.aborted) {
      break;
    }

    const params: { id: string } & Record<string, string | number> = {
      id: groupId,
      'page[size]': GROUP_ANNOTATIONS_PAGE_SIZE,
    };
    if (pageAfter) {
      params['page[after]'] = pageAfter;
    }

    const result = await api.group.annotations.read(params, undefined, signal);
    const data = result.data ?? [];
    for (const ann of data) {
      if (isSaved(ann)) {
        annotations.push(ann);
      }
    }

    if (data.length < GROUP_ANNOTATIONS_PAGE_SIZE) {
      break;
    }

    const nextCursor = data[data.length - 1]?.created;
    if (!nextCursor || nextCursor === pageAfter) {
      break;
    }
    pageAfter = nextCursor;
  }

  return annotations;
}

/**
 * Keeps tag inventory rows in sync and loads all group annotations for
 * private-group AI few-shot examples.
 */
// @inject
export class TagInventoryGroupSyncService {
  private _api: APIService;
  private _store: SidebarStore;
  private _syncing = false;
  private _initDone = false;
  private _groupAnnotationCache = new Map<string, SavedAnnotation[]>();
  private _groupAnnotationCacheLoaded = new Set<string>();
  private _activeSync: Promise<void> | null = null;
  private _syncOnStack = false;
  private _resyncAfterCurrent = false;
  private _groupFetchPromises = new Map<string, Promise<SavedAnnotation[]>>();
  private _groupFetchControllers = new Map<string, AbortController>();

  constructor(api: APIService, store: SidebarStore) {
    this._api = api;
    this._store = store;
  }

  init() {
    if (this._initDone) {
      return;
    }
    this._initDone = true;

    // Re-sync when the document URI becomes available after the frame
    // re-registers (e.g. sidebar opened by annotation creation before
    // documentInfoChanged arrives). This fires the first time currentDocumentUri
    // transitions from null to a real value, creating rows with the correct URI.
    watch(
      this._store.subscribe,
      () => currentDocumentUri(this._store),
      (docUri, prevDocUri) => {
        if (docUri && !prevDocUri) {
          const groupId = this._store.focusedGroupId();
          if (groupId === PUBLIC_GROUP_ID) {
            void this.applyStoreAnnotationsToInventory();
          }
        }
      },
    );

    watch(
      this._store.subscribe,
      () =>
        [
          this._store.hasFetchedProfile(),
          this._store.focusedGroupId(),
        ] as const,
      ([hasProfile, groupId], [, prevGroupId]) => {
        if (!hasProfile || !groupId) {
          return;
        }
        if (prevGroupId && prevGroupId !== groupId) {
          this._clearGroupAnnotationCache();
        }
        queueMicrotask(() => {
          if (groupId === PUBLIC_GROUP_ID) {
            void this.applyStoreAnnotationsToInventory();
          } else {
            void this.getGroupAnnotations(groupId).catch(err => {
              console.warn(
                '[TagInventoryGroupSync] group annotations load failed',
                err,
              );
            });
          }
        });
      },
      focusedGroupWatchValuesEqual,
    );
  }

  /**
   * Annotations from the last successful full-group fetch for `groupId`.
   * Returns `null` if that group has not been fetched yet (distinct from `[]`).
   */
  cachedGroupAnnotations(groupId: string): SavedAnnotation[] | null {
    if (!this._groupAnnotationCacheLoaded.has(groupId)) {
      return null;
    }
    return this._groupAnnotationCache.get(groupId) ?? [];
  }

  /**
   * Load all annotations in a private group (cached; one in-flight fetch per
   * `groupId`). Updates inventory rows from the full group set.
   */
  async getGroupAnnotations(
    groupId: string,
    { force = false }: { force?: boolean } = {},
  ): Promise<SavedAnnotation[]> {
    if (groupId === PUBLIC_GROUP_ID) {
      return savedAnnotationsForCurrentDocument(
        this._store.savedAnnotations(),
        groupId,
        this._store.searchUris(),
      );
    }

    const inFlight = this._groupFetchPromises.get(groupId);
    if (inFlight) {
      return inFlight;
    }

    if (!force) {
      const cached = this.cachedGroupAnnotations(groupId);
      if (cached !== null) {
        return cached;
      }
    }

    const controller = new AbortController();
    this._groupFetchControllers.set(groupId, controller);

    const work = (async () => {
      try {
        const annotations = await fetchAllGroupAnnotations(
          this._api,
          groupId,
          controller.signal,
        );
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        this._setGroupAnnotationCache(groupId, annotations);
        this._applyFullGroupInventory(groupId, annotations);
        return annotations;
      } finally {
        this._groupFetchPromises.delete(groupId);
        this._groupFetchControllers.delete(groupId);
      }
    })();

    this._groupFetchPromises.set(groupId, work);
    return work;
  }

  /**
   * Reconcile tag inventory rows from annotations already loaded for the
   * current document. No network requests.
   */
  async applyStoreAnnotationsToInventory(options: SyncGroupInventoryOptions = {}) {
    if (this._syncOnStack) {
      this._resyncAfterCurrent = true;
      return this._activeSync ?? Promise.resolve();
    }

    const groupId = this._store.focusedGroupId();
    if (!groupId) {
      return;
    }

    const documentUris = options.documentUris ?? this._store.searchUris();
    this._syncing = true;
    this._syncOnStack = true;

    const syncWork = (async () => {
      try {
        const annotations = filterAnnotationsForDocumentScope(
          this._store.savedAnnotations(),
          groupId,
          documentUris,
        );
        const resolvedUri = currentDocumentUri(this._store) ?? documentUris[0] ?? '';
        this._applyDocumentInventory(groupId, annotations, { documentUri: resolvedUri });
      } catch (err) {
        console.warn('[TagInventoryGroupSync] document sync failed', err);
      } finally {
        this._syncing = false;
      }
    })();

    this._activeSync = syncWork;
    try {
      await syncWork;
    } finally {
      this._syncOnStack = false;
      if (this._activeSync === syncWork) {
        this._activeSync = null;
      }
      if (this._resyncAfterCurrent) {
        this._resyncAfterCurrent = false;
        void this.applyStoreAnnotationsToInventory(options);
      }
    }
  }

  /**
   * Upsert realtime updates into the private-group cache and drop deletions.
   * No-op when the cache has not been populated yet.
   */
  mergePendingUpdatesIntoCache(
    updates: Annotation[],
    deletedIds: string[],
  ) {
    const groupId = this._store.focusedGroupId();
    if (!groupId || groupId === PUBLIC_GROUP_ID) {
      return;
    }
    if (!this._groupAnnotationCacheLoaded.has(groupId)) {
      return;
    }

    const deletionSet = new Set(deletedIds);
    const cached = (this._groupAnnotationCache.get(groupId) ?? []).filter(
      ann => !ann.id || !deletionSet.has(ann.id),
    );

    for (const ann of updates) {
      if (!isSaved(ann) || ann.group !== groupId) {
        continue;
      }
      const idx = cached.findIndex(a => a.id === ann.id);
      if (idx >= 0) {
        cached[idx] = ann;
      } else {
        cached.push(ann);
      }
    }

    this._setGroupAnnotationCache(groupId, cached);
  }

  private _applyDocumentInventory(
    groupId: string,
    annotations: SavedAnnotation[],
    options?: { documentUri?: string },
  ) {
    applyDerivedTagInventoryRows(this._store, {
      groupId,
      annotations,
      documentUri:
        options?.documentUri ??
        currentDocumentUri(this._store) ??
        '',
    });
  }

  private _applyFullGroupInventory(
    groupId: string,
    annotations: SavedAnnotation[],
  ) {
    this._applyDocumentInventory(groupId, annotations);
    if (groupId !== PUBLIC_GROUP_ID) {
      const descriptors = deriveTagInventoryRowDescriptors(annotations);
      this._store.pruneTagInventoryRowsForGroup(groupId, descriptors);
    }
  }

  private _clearGroupAnnotationCache() {
    for (const controller of this._groupFetchControllers.values()) {
      controller.abort();
    }
    this._groupFetchControllers.clear();
    this._groupFetchPromises.clear();
    this._groupAnnotationCache.clear();
    this._groupAnnotationCacheLoaded.clear();
  }

  private _setGroupAnnotationCache(
    groupId: string,
    annotations: SavedAnnotation[],
  ) {
    this._groupAnnotationCache.set(groupId, annotations);
    this._groupAnnotationCacheLoaded.add(groupId);
  }
}
