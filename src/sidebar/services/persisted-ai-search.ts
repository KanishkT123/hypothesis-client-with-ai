import type { SidebarStore } from '../store';
import type { AISearchState } from '../store/modules/sidebar-panels';
import { watch } from '../util/watch';
import type { LocalStorageService } from './local-storage';

/** `localStorage` key for persisted AI search rows and tag colors. */
export const AI_SEARCH_STORAGE_KEY = 'hypothesis.aiSearch.history';

const emptyAiSearch = (): AISearchState => ({
  rows: [],
  schemaTagColors: {},
});

/**
 * Validate and return `AISearchState` from parsed JSON, or `null` if invalid.
 */
export function parseAISearchState(raw: unknown): AISearchState | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const v = raw as Record<string, unknown>;
  if (!Array.isArray(v.rows)) {
    return null;
  }
  if (
    !v.schemaTagColors ||
    typeof v.schemaTagColors !== 'object' ||
    Array.isArray(v.schemaTagColors)
  ) {
    return null;
  }
  const rows = [];
  for (const row of v.rows) {
    if (!row || typeof row !== 'object') {
      return null;
    }
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string') {
      return null;
    }
    if (typeof r.schemaTag !== 'string') {
      return null;
    }
    if (typeof r.query !== 'string') {
      return null;
    }
    if (!Array.isArray(r.annotationIds)) {
      return null;
    }
    if (!r.annotationIds.every((id: unknown) => typeof id === 'string')) {
      return null;
    }
    rows.push({
      id: r.id,
      schemaTag: r.schemaTag,
      query: r.query,
      annotationIds: r.annotationIds as string[],
    });
  }
  const schemaTagColors: Record<string, string> = {};
  for (const [k, c] of Object.entries(v.schemaTagColors as Record<string, unknown>)) {
    if (typeof c !== 'string') {
      return null;
    }
    schemaTagColors[k] = c;
  }
  return { rows, schemaTagColors };
}

/**
 * Persists `sidebarPanels.aiSearch` to `localStorage`, restores it on load, and
 * applies updates from other browser tabs via the `storage` event (see
 * `AuthService` for the same pattern for OAuth tokens).
 *
 * @inject
 */
export class PersistedAISearchService {
  private _storage: LocalStorageService;
  private _store: SidebarStore;
  private _window: Window;

  constructor(
    localStorage: LocalStorageService,
    store: SidebarStore,
    $window: Window,
  ) {
    this._storage = localStorage;
    this._store = store;
    this._window = $window;
  }

  init() {
    const persisted = this._storage.getObject<unknown>(AI_SEARCH_STORAGE_KEY);
    const parsed = parseAISearchState(persisted);
    if (parsed) {
      this._store.hydrateAISearch(parsed);
    }

    watch(
      this._store.subscribe,
      () => this._store.getState().sidebarPanels.aiSearch,
      current => {
        this._storage.setObject(AI_SEARCH_STORAGE_KEY, current);
      },
      (a, b) => JSON.stringify(a) === JSON.stringify(b),
    );

    /**
     * Apply persisted state from storage into Redux when it differs from the
     * current slice.
     *
     * For `storage` events, prefer `event.newValue` so we apply exactly what
     * changed (matches browser behavior; tests' fake storage does not update on
     * events). For `visibilitychange` / `focus`, re-read via `getObject`.
     */
    const syncFromLocalStorage = (e?: StorageEvent) => {
      let raw: unknown;

      if (e) {
        // Ignore updates to other keys; `key === null` means storage was cleared.
        if (e.key !== null && e.key !== AI_SEARCH_STORAGE_KEY) {
          return;
        }
        if (e.key === AI_SEARCH_STORAGE_KEY && e.newValue !== null) {
          try {
            raw = JSON.parse(e.newValue);
          } catch {
            return;
          }
        } else if (e.key === AI_SEARCH_STORAGE_KEY && e.newValue === null) {
          raw = null;
        } else {
          raw = this._storage.getObject<unknown>(AI_SEARCH_STORAGE_KEY);
        }
      } else {
        raw = this._storage.getObject<unknown>(AI_SEARCH_STORAGE_KEY);
      }

      if (raw === null) {
        const empty = emptyAiSearch();
        const current = this._store.getState().sidebarPanels.aiSearch;
        if (JSON.stringify(empty) !== JSON.stringify(current)) {
          this._store.hydrateAISearch(empty);
        }
        return;
      }
      const next = parseAISearchState(raw);
      if (!next) {
        return;
      }
      const current = this._store.getState().sidebarPanels.aiSearch;
      if (JSON.stringify(next) === JSON.stringify(current)) {
        return;
      }
      this._store.hydrateAISearch(next);
    };

    this._window.addEventListener('storage', (e: StorageEvent) => {
      syncFromLocalStorage(e);
    });

    this._window.document.addEventListener('visibilitychange', () => {
      if (this._window.document.visibilityState === 'visible') {
        syncFromLocalStorage();
      }
    });

    this._window.addEventListener('focus', () => {
      syncFromLocalStorage();
    });
  }
}
