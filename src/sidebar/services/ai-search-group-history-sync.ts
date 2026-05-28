import type { SavedAnnotation } from '../../types/api';
import { isSaved } from '../helpers/annotation-metadata';
import {
  deriveAISearchHistoryRowDescriptors,
} from '../helpers/ai-search-group-history';
import { PUBLIC_GROUP_ID } from '../helpers/groups';
import type { SidebarStore } from '../store';
import { watch } from '../util/watch';
import type { APIService } from './api';
import { applyDerivedAISearchHistoryRows } from './ai-search-history-reconcile';

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
export type SyncGroupHistoryMode = 'auto' | 'document';

export type SyncGroupHistoryOptions = {
  documentUris?: string[];
  mode?: SyncGroupHistoryMode;
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

function resolveEffectiveMode(
  groupId: string,
  mode: SyncGroupHistoryMode,
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
 * Sync AI search history rows with annotations in the focused group.
 *
 * Private groups fetch all group annotations; Public uses the current document only.
 */
// @inject
export class AISearchGroupHistorySyncService {
  private _api: APIService;
  private _store: SidebarStore;
  private _syncController: AbortController | null = null;
  private _syncing = false;
  private _initDone = false;

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
        }
        void this.syncGroupHistory({ mode: 'auto' });
      },
    );
  }

  isSyncingGroupHistory(): boolean {
    return this._syncing;
  }

  private _abortSync() {
    this._syncController?.abort();
    this._syncController = null;
    this._syncing = false;
  }

  async syncGroupHistory(options: SyncGroupHistoryOptions = {}) {
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

    try {
      let annotations: SavedAnnotation[];

      if (effectiveMode === 'document') {
        annotations = filterAnnotationsForDocumentScope(
          this._store.savedAnnotations(),
          groupId,
          documentUris,
        );
      } else {
        annotations = await fetchAllGroupAnnotations(this._api, groupId, signal);
        if (signal.aborted) {
          return;
        }
      }

      applyDerivedAISearchHistoryRows(this._store, {
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
        const descriptors = deriveAISearchHistoryRowDescriptors(annotations);
        this._store.pruneAISearchRowsForGroup(groupId, descriptors);
      }
    } catch (err) {
      if (!signal.aborted) {
        console.warn('[AISearchGroupHistorySync] sync failed', err);
      }
    } finally {
      if (!signal.aborted) {
        this._syncing = false;
        this._syncController = null;
      }
    }
  }
}
