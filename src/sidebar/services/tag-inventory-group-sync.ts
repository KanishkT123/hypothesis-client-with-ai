import type { Annotation, SavedAnnotation } from '../../types/api';
import { isSaved } from '../helpers/annotation-metadata';
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

/**
 * - `auto`: choose by group type — Public re-derives from the current document;
 *   private groups do a full paginated group fetch (used for group switch, doc
 *   load, and the Refresh-group-tags button).
 * - `document`: cheap, no-network re-derive from already-loaded `savedAnnotations()`
 *   (used for local annotation CRUD and realtime updates on the current page).
 */
export type SyncGroupInventoryMode = 'auto' | 'document';

export type SyncGroupInventoryOptions = {
  documentUris?: string[];
  mode?: SyncGroupInventoryMode;
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

function resolveEffectiveMode(
  groupId: string,
  mode: SyncGroupInventoryMode,
): 'document' | 'fullGroup' {
  if (mode === 'document') {
    return 'document';
  }
  // `auto`: Public stays document-scoped; private groups do a full fetch.
  return groupId === PUBLIC_GROUP_ID ? 'document' : 'fullGroup';
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

    // `page[after]` is a date cursor; results are newest-first, so the next
    // (older) page starts after the oldest annotation's creation date.
    const nextCursor = data[data.length - 1]?.created;
    if (!nextCursor || nextCursor === pageAfter) {
      break;
    }
    pageAfter = nextCursor;
  }

  return annotations;
}

/**
 * Sync tag inventory rows with annotations in the focused group.
 *
 * Private groups fetch all group annotations; Public uses the current document only.
 */
// @inject
export class TagInventoryGroupSyncService {
  private _api: APIService;
  private _store: SidebarStore;
  private _syncController: AbortController | null = null;
  private _syncing = false;
  private _initDone = false;
  /** Full group fetch results keyed by `groupId`; `undefined` = not loaded yet. */
  private _groupAnnotationCache = new Map<string, SavedAnnotation[]>();
  private _groupAnnotationCacheLoaded = new Set<string>();
  private _activeSync: Promise<void> | null = null;
  /** True while a sync pass is on the stack (guards re-entrant calls). */
  private _syncOnStack = false;
  /** Run one more sync after the current pass if re-entry was attempted. */
  private _resyncAfterCurrent = false;

  constructor(api: APIService, store: SidebarStore) {
    this._api = api;
    this._store = store;
  }

  init() {
    if (this._initDone) {
      return;
    }
    this._initDone = true;

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
          this._abortSync();
          this._clearGroupAnnotationCache();
        }
        // Never start sync synchronously inside a store subscriber — API
        // requests dispatch apiRequestStarted/finished and would re-enter.
        queueMicrotask(() => {
          void this.syncGroupInventory({ mode: 'auto' });
        });
      },
      focusedGroupWatchValuesEqual,
    );
  }

  isSyncingGroupInventory(): boolean {
    return this._syncing;
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

  /** Await the in-flight sync, if any (used before private-group AI search). */
  async waitForSyncIfInFlight(): Promise<void> {
    if (this._activeSync) {
      await this._activeSync;
    }
  }

  /**
   * Upsert realtime updates into the private-group cache and drop deletions.
   * No-op when the cache has not been populated yet (Public groups included).
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

  private _clearGroupAnnotationCache() {
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

  private _abortSync() {
    this._syncController?.abort();
    this._syncController = null;
    this._syncing = false;
  }

  async syncGroupInventory(options: SyncGroupInventoryOptions = {}) {
    if (this._syncOnStack) {
      this._resyncAfterCurrent = true;
      return this._activeSync ?? Promise.resolve();
    }

    const groupId = this._store.focusedGroupId();
    if (!groupId) {
      return;
    }

    const mode = options.mode ?? 'auto';
    const effectiveMode = resolveEffectiveMode(groupId, mode);
    const documentUris = options.documentUris ?? this._store.searchUris();

    this._abortSync();
    this._syncController = new AbortController();
    const { signal } = this._syncController;
    this._syncing = true;
    this._syncOnStack = true;

    const syncWork = (async () => {
      try {
        let annotations: SavedAnnotation[];

        if (effectiveMode === 'document') {
          annotations = filterAnnotationsForDocumentScope(
            this._store.savedAnnotations(),
            groupId,
            documentUris,
          );
        } else {
          annotations = await fetchAllGroupAnnotations(
            this._api,
            groupId,
            signal,
          );
          if (signal.aborted) {
            return;
          }
          this._setGroupAnnotationCache(groupId, annotations);
        }

        applyDerivedTagInventoryRows(this._store, {
          groupId,
          annotations,
          updatePublicScope: groupId === PUBLIC_GROUP_ID,
          documentUri: documentUris[0] ?? this._store.mainFrame()?.uri ?? '',
        });

        if (
          effectiveMode === 'fullGroup' &&
          groupId !== PUBLIC_GROUP_ID &&
          !signal.aborted
        ) {
          const descriptors = deriveTagInventoryRowDescriptors(annotations);
          this._store.pruneTagInventoryRowsForGroup(groupId, descriptors);
        }
      } catch (err) {
        if (!signal.aborted) {
          console.warn('[TagInventoryGroupSync] sync failed', err);
        }
      } finally {
        if (!signal.aborted) {
          this._syncing = false;
          this._syncController = null;
        }
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
        void this.syncGroupInventory(options);
      }
    }
  }
}
