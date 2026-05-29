import type { SidebarStore } from '../store';
import type {
  AISearchRow,
  AISearchState,
} from '../store/modules/sidebar-panels';
import { emptyExperimentLog } from '../store/modules/sidebar-panels';
import { watch } from '../util/watch';
import {
  EXPERIMENT_LOG_STORAGE_KEY,
  parseExperimentLogState,
} from './experiment-log';
import type { LocalStorageService } from './local-storage';
import type { ToastMessengerService } from './toast-messenger';

/** `localStorage` key for persisted AI search rows and tag colors. */
export const AI_SEARCH_STORAGE_KEY = 'hypothesis.aiSearch.history';

export { EXPERIMENT_LOG_STORAGE_KEY } from './experiment-log';

const emptyAiSearch = (): AISearchState => ({
  rows: [],
  schemaTagColors: {},
});

/**
 * Validate `rows` and `schemaTagColors` on a persisted object (no `revision`).
 */
function parseAISearchStatePayload(v: Record<string, unknown>): AISearchState | null {
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
    if ('hidden' in r && typeof r.hidden !== 'boolean') {
      return null;
    }
    if ('groupId' in r && typeof r.groupId !== 'string') {
      return null;
    }
    const parsed: AISearchRow = {
      id: r.id,
      schemaTag: r.schemaTag,
      query: r.query,
      annotationIds: r.annotationIds as string[],
    };
    if (typeof r.groupId === 'string') {
      parsed.groupId = r.groupId;
    }
    if (r.hidden === true) {
      parsed.hidden = true;
    }
    rows.push(parsed);
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

export type ParsedAISearchPersisted = {
  revision: number;
  aiSearch: AISearchState;
};

/**
 * Validate persisted AI search history JSON `{ revision, rows, schemaTagColors }`.
 */
export function parseAISearchPersisted(raw: unknown): ParsedAISearchPersisted | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const v = raw as Record<string, unknown>;
  const rev = v.revision;
  if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 0) {
    return null;
  }
  const aiSearch = parseAISearchStatePayload(v);
  if (!aiSearch) {
    return null;
  }
  return { revision: rev, aiSearch };
}

function readAISearchRevisionFromStorageRaw(raw: unknown): number {
  if (!raw || typeof raw !== 'object') {
    return 0;
  }
  const r = (raw as Record<string, unknown>).revision;
  if (typeof r === 'number' && Number.isInteger(r) && r >= 0) {
    return r;
  }
  return 0;
}

type StorageSyncConfig<T> = {
  storageKey: string;
  parse: (raw: unknown) => T | null;
  empty: () => T;
  getCurrent: () => T;
  hydrate: (value: T) => void;
};

/**
 * Persists `sidebarPanels.aiSearch` (and the experiment log) to `localStorage`,
 * restores on load, and applies updates from other browser tabs via the
 * `storage` event (see `AuthService` for the same pattern for OAuth tokens).
 *
 * @inject
 */
export class PersistedAISearchService {
  private _storage: LocalStorageService;
  private _store: SidebarStore;
  private _window: Window;
  private _toastMessenger: ToastMessengerService;
  /** Monotonic revision for `AI_SEARCH_STORAGE_KEY`; ignores stale sync reads. */
  private _aiSearchRevision = 0;

  constructor(
    localStorage: LocalStorageService,
    store: SidebarStore,
    $window: Window,
    toastMessenger: ToastMessengerService,
  ) {
    this._storage = localStorage;
    this._store = store;
    this._window = $window;
    this._toastMessenger = toastMessenger;
  }

  private _syncFromLocalStorage<T>(
    config: StorageSyncConfig<T>,
    e?: StorageEvent,
  ) {
    const { storageKey, parse, empty, getCurrent, hydrate } = config;
    let raw: unknown;

    if (e) {
      if (e.key !== null && e.key !== storageKey) {
        return;
      }
      if (e.key === storageKey && e.newValue !== null) {
        try {
          raw = JSON.parse(e.newValue);
        } catch {
          return;
        }
      } else if (e.key === storageKey && e.newValue === null) {
        raw = null;
      } else {
        raw = this._storage.getObject<unknown>(storageKey);
      }
    } else {
      raw = this._storage.getObject<unknown>(storageKey);
    }

    if (raw === null) {
      const emp = empty();
      if (JSON.stringify(emp) !== JSON.stringify(getCurrent())) {
        hydrate(emp);
      }
      return;
    }
    const next = parse(raw);
    if (!next) {
      return;
    }
    if (JSON.stringify(next) === JSON.stringify(getCurrent())) {
      return;
    }
    hydrate(next);
  }

  private _syncAISearchFromLocalStorage(e?: StorageEvent) {
    const storageKey = AI_SEARCH_STORAGE_KEY;
    let raw: unknown;

    if (e) {
      if (e.key !== null && e.key !== storageKey) {
        return;
      }
      if (e.key === storageKey && e.newValue !== null) {
        try {
          raw = JSON.parse(e.newValue);
        } catch {
          return;
        }
      } else if (e.key === storageKey && e.newValue === null) {
        raw = null;
      } else {
        raw = this._storage.getObject<unknown>(storageKey);
      }
    } else {
      raw = this._storage.getObject<unknown>(storageKey);
    }

    const empty = emptyAiSearch();
    const getCurrent = () => this._store.getState().sidebarPanels.aiSearch;

    if (raw === null) {
      this._aiSearchRevision = 0;
      if (JSON.stringify(empty) !== JSON.stringify(getCurrent())) {
        this._store.hydrateAISearch(empty);
      }
      return;
    }

    const parsed = parseAISearchPersisted(raw);
    if (!parsed) {
      return;
    }

    const { revision: incomingRevision, aiSearch } = parsed;

    if (incomingRevision < this._aiSearchRevision) {
      return;
    }

    if (JSON.stringify(aiSearch) === JSON.stringify(getCurrent())) {
      this._aiSearchRevision = Math.max(
        this._aiSearchRevision,
        incomingRevision,
      );
      return;
    }

    this._store.hydrateAISearch(aiSearch);
    this._aiSearchRevision = incomingRevision;
  }

  init() {
    const persisted = this._storage.getObject<unknown>(AI_SEARCH_STORAGE_KEY);
    const parsed = parseAISearchPersisted(persisted);
    if (parsed) {
      this._store.hydrateAISearch(parsed.aiSearch);
      this._aiSearchRevision = parsed.revision;
    } else {
      this._aiSearchRevision = 0;
    }

    const expRaw = this._storage.getObject<unknown>(EXPERIMENT_LOG_STORAGE_KEY);
    const expParsed = parseExperimentLogState(expRaw);
    if (expParsed) {
      this._store.hydrateExperimentLog(expParsed);
    }

    watch(
      this._store.subscribe,
      () => this._store.getState().sidebarPanels.aiSearch,
      current => {
        const lsRaw = this._storage.getObject<unknown>(AI_SEARCH_STORAGE_KEY);
        const readRev = readAISearchRevisionFromStorageRaw(lsRaw);
        this._aiSearchRevision = Math.max(this._aiSearchRevision, readRev) + 1;
        this._storage.setObject(AI_SEARCH_STORAGE_KEY, {
          revision: this._aiSearchRevision,
          ...current,
        });
      },
      (a, b) => JSON.stringify(a) === JSON.stringify(b),
    );

    watch(
      this._store.subscribe,
      () => this._store.getState().sidebarPanels.experimentLog,
      current => {
        try {
          this._storage.setObject(EXPERIMENT_LOG_STORAGE_KEY, current);
        } catch (e: unknown) {
          const name = e instanceof DOMException ? e.name : (e as Error)?.name;
          if (name === 'QuotaExceededError') {
            this._toastMessenger.error(
              'Could not save the experiment log: storage is full. Download or clear the log.',
            );
          } else {
            console.warn('[experimentLog] Failed to persist', e);
          }
        }
      },
      (a, b) => JSON.stringify(a) === JSON.stringify(b),
    );

    const syncHistory = (e?: StorageEvent) => this._syncAISearchFromLocalStorage(e);

    const syncExperimentLog = (e?: StorageEvent) =>
      this._syncFromLocalStorage(
        {
          storageKey: EXPERIMENT_LOG_STORAGE_KEY,
          parse: parseExperimentLogState,
          empty: emptyExperimentLog,
          getCurrent: () =>
            this._store.getState().sidebarPanels.experimentLog,
          hydrate: v => this._store.hydrateExperimentLog(v),
        },
        e,
      );

    this._window.addEventListener('storage', (e: StorageEvent) => {
      syncHistory(e);
      syncExperimentLog(e);
    });

    this._window.document.addEventListener('visibilitychange', () => {
      if (this._window.document.visibilityState === 'visible') {
        syncHistory();
        syncExperimentLog();
      }
    });

    this._window.addEventListener('focus', () => {
      syncHistory();
      syncExperimentLog();
    });
  }
}
