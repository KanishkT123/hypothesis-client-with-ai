/**
 * This module handles the state for `SidebarPanel` components used in the app.
 * It keeps track of the "active" `panelName` (simple string) and allows the
 * opening, closing or toggling of panels via their `panelName`. It merely
 * retains the `panelName` state as a string: it has no understanding nor
 * opinions about whether a given `panelName` corresponds to one or more
 * extant `SidebarPanel` components. Only one panel (as keyed by `panelName`)
 * may be "active" (open) at one time.
 *
 * Also holds state for the AI search panel (`aiSearch`). Rows and colors are
 * hydrated from `localStorage` at startup and kept in sync across tabs by
 * `PersistedAISearchService`.
 */
import type { PanelName } from '../../../types/sidebar';
import { highlightRgbaFromString } from '../../../shared/tag-color-from-string';
import {
  pruneAISearchRowsToDescriptors,
  type AISearchHistoryRowDescriptor,
} from '../../helpers/ai-search-group-history';
import { createStoreModule, makeAction } from '../create-store';

export type AISearchRow = {
  id: string;
  schemaTag: string;
  query: string;
  annotationIds: string[];
  /** Focused group when the row was created or synced. */
  groupId?: string;
  /** When true, row can be filtered out of the history table (see AISearchPanel). */
  hidden?: boolean;
};

/** Which Public-document history rows are visible for the current PDF. */
export type AISearchPublicDocumentScope = {
  documentUri: string;
  visibleDescriptorKeys: string[];
};

/** Local snapshot from a user-denied ai-pending annotation (not persisted on server). */
export type AISearchNegativeExample = {
  id: string;
  schemaTag: string;
  query: string;
  quote: string;
  documentUri: string;
};

export type AISearchState = {
  rows: AISearchRow[];
  schemaTagColors: Record<string, string>;
};

/** Single-participant HCI experiment log (persisted via `PersistedAISearchService`). */
export type ExperimentEvent =
  | {
      type: 'search';
      timestamp: string;
      documentUri: string;
      searchRowId: string;
      query: string;
      schemaTag: string;
      annotationIdsCreated: string[];
      /** Parallel to `annotationIdsCreated` (same length when present). Omitted in older logs. */
      quoteTexts?: string[];
    }
  | {
      type: 'accept';
      timestamp: string;
      documentUri: string;
      annotationId: string;
      quoteText: string;
      schemaTag: string;
    }
  | {
      type: 'reject';
      timestamp: string;
      documentUri: string;
      annotationId: string;
      quoteText: string;
      schemaTag: string;
    }
  | {
      type: 'rerun-search';
      timestamp: string;
      documentUri: string;
      searchRowId: string;
      query: string;
      schemaTag: string;
    }
  | {
      type: 'delete-pending';
      timestamp: string;
      documentUri: string;
      searchRowId: string;
      query: string;
      schemaTag: string;
    }
  | {
      type: 'delete-all';
      timestamp: string;
      documentUri: string;
      searchRowId: string;
      query: string;
      schemaTag: string;
    }
  | {
      type: 'annotation-deleted';
      timestamp: string;
      documentUri: string;
      annotationId: string;
      quoteText: string;
      schemaTag: string;
    };

export type ExperimentLogState = {
  version: 1;
  events: ExperimentEvent[];
};

export type State = {
  /**
   * The `panelName` of the currently-active sidebar panel.
   * Only one `panelName` may be active at a time, but it is valid (though not
   * the standard use case) for multiple `SidebarPanel` components to share
   * the same `panelName`—`panelName` is not intended as a unique ID/key.
   *
   * e.g. If `activePanelName` were `foobar`, all `SidebarPanel` components
   * with `panelName` of `foobar` would be active, and thus visible.
   */
  activePanelName: PanelName | null;

  /** Table rows and per–schema-tag highlight colors for the AI search panel. */
  aiSearch: AISearchState;

  /**
   * Locally stored negative training examples (declined ai-pending annotations).
   * Persisted separately from `aiSearch`; see `PersistedAISearchService`.
   */
  aiSearchNegativeExamples: AISearchNegativeExample[];

  /** AI search experiment log; persisted under `hypothesis.aiSearch.experimentLog`. */
  experimentLog: ExperimentLogState;

  /**
   * Public group only: descriptor keys for rows derived on the current document.
   * Other Public rows stay stored but are hidden until that document is opened again.
   */
  aiSearchPublicDocumentScope: AISearchPublicDocumentScope | null;
};

const initialAiSearch: AISearchState = {
  rows: [],
  schemaTagColors: {},
};

export const emptyExperimentLog = (): ExperimentLogState => ({
  version: 1,
  events: [],
});

const initialState: State = {
  activePanelName: null,
  aiSearch: initialAiSearch, //TODO: Rename
  aiSearchNegativeExamples: [],
  experimentLog: emptyExperimentLog(),
  aiSearchPublicDocumentScope: null,
};

const reducers = {
  OPEN_SIDEBAR_PANEL(state: State, action: { panelName: PanelName }) {
    return { activePanelName: action.panelName };
  },

  CLOSE_SIDEBAR_PANEL(state: State, action: { panelName: PanelName }) {
    let activePanelName = state.activePanelName;
    if (action.panelName === activePanelName) {
      // `action.panelName` is indeed the currently-active panel; deactivate
      activePanelName = null;
    }
    // `action.panelName` is not the active panel; nothing to do here
    return {
      activePanelName,
    };
  },

  TOGGLE_SIDEBAR_PANEL(
    state: State,
    action: { panelName: PanelName; panelState?: boolean },
  ) {
    let activePanelName;
    // Is the panel in question currently the active panel?
    const panelIsActive = state.activePanelName === action.panelName;
    // What state should the panel in question move to next?
    const panelShouldBeActive =
      typeof action.panelState !== 'undefined'
        ? action.panelState
        : !panelIsActive;

    if (panelShouldBeActive) {
      // If the specified panel should be open (active), set it as active
      activePanelName = action.panelName;
    } else if (panelIsActive && !panelShouldBeActive) {
      // If the specified panel is currently open (active), but it shouldn't be anymore
      activePanelName = null;
    } else {
      // This panel is already inactive; do nothing
      activePanelName = state.activePanelName;
    }

    return {
      activePanelName,
    };
  },

  ADD_AI_SEARCH_ROW(state: State, action: { row: AISearchRow }) {
    const { row } = action;
    const rows = [row, ...state.aiSearch.rows];
    const tag = row.schemaTag.trim();
    let { schemaTagColors } = state.aiSearch;
    if (tag && schemaTagColors[tag] === undefined) {
      schemaTagColors = {
        ...schemaTagColors,
        [tag]: highlightRgbaFromString(tag),
      };
    }
    return {
      aiSearch: { rows, schemaTagColors },
    };
  },

  SET_AI_SEARCH_ROW_HIDDEN(
    state: State,
    action: { rowId: string; hidden: boolean },
  ) {
    return {
      aiSearch: {
        ...state.aiSearch,
        rows: state.aiSearch.rows.map(r => {
          if (r.id !== action.rowId) {
            return r;
          }
          if (action.hidden) {
            return { ...r, hidden: true };
          }
          if (!('hidden' in r)) {
            return r;
          }
          const next = { ...r };
          delete next.hidden;
          return next;
        }),
      },
    };
  },

  REMOVE_AI_SEARCH_ROW(state: State, action: { rowId: string }) {
    const rows = state.aiSearch.rows.filter(r => r.id !== action.rowId);
    // Keep `schemaTagColors` untouched: a tag's color (including any user
    // override via SET_AI_SEARCH_SCHEMA_TAG_COLOR) is sticky, so if the tag
    // reappears later it reuses the same color instead of resetting.
    return {
      aiSearch: { ...state.aiSearch, rows },
    };
  },

  SET_AI_SEARCH_SCHEMA_TAG_COLOR(
    state: State,
    action: { schemaTag: string; rgba: string },
  ) {
    return {
      aiSearch: {
        ...state.aiSearch,
        schemaTagColors: {
          ...state.aiSearch.schemaTagColors,
          [action.schemaTag]: action.rgba,
        },
      },
    };
  },

  /**
   * Replace the full `aiSearch` slice (e.g. from `localStorage` on load or
   * when another tab updates storage).
   */
  HYDRATE_AI_SEARCH(state: State, action: { aiSearch: AISearchState }) {
    return {
      aiSearch: action.aiSearch,
    };
  },

  /**
   * Merge all rows with the same trimmed tag+query as `keepRowId` into that
   * row (union of `annotationIds`) and remove the other duplicate rows.
   */
  MERGE_AI_SEARCH_ROWS_SAME_TAG_QUERY(
    state: State,
    action: { keepRowId: string },
  ) {
    const { rows } = state.aiSearch;
    const keep = rows.find(r => r.id === action.keepRowId);
    if (!keep) {
      return state;
    }
    const tagKey = keep.schemaTag.trim();
    const queryKey = keep.query.trim();
    const groupKey = keep.groupId ?? '';
    const sameKey = (r: AISearchRow) =>
      (r.groupId ?? '') === groupKey &&
      r.schemaTag.trim() === tagKey &&
      r.query.trim() === queryKey;

    const duplicates = rows.filter(sameKey);
    const unionIds = [
      ...new Set(duplicates.flatMap(r => r.annotationIds)),
    ];
    const allHidden = duplicates.every(r => r.hidden === true);

    const newRows = rows
      .filter(r => !(sameKey(r) && r.id !== action.keepRowId))
      .map(r => {
        if (r.id !== action.keepRowId) {
          return r;
        }
        const merged = { ...r, annotationIds: unionIds };
        if (allHidden) {
          return { ...merged, hidden: true as const };
        }
        if (!('hidden' in merged)) {
          return merged;
        }
        const next = { ...merged };
        delete next.hidden;
        return next;
      });

    return {
      aiSearch: {
        ...state.aiSearch,
        rows: newRows,
      },
    };
  },

  SET_AI_SEARCH_ROW_ANNOTATION_IDS(
    state: State,
    action: { rowId: string; annotationIds: string[] },
  ) {
    return {
      aiSearch: {
        ...state.aiSearch,
        rows: state.aiSearch.rows.map(r =>
          r.id === action.rowId
            ? { ...r, annotationIds: action.annotationIds }
            : r,
        ),
      },
    };
  },

  REMOVE_AI_SEARCH_ANNOTATION_IDS(
    state: State,
    action: { annotationIds: string[] },
  ) {
    const idSet = new Set(action.annotationIds);
    return {
      aiSearch: {
        ...state.aiSearch,
        rows: state.aiSearch.rows.map(r => ({
          ...r,
          annotationIds: r.annotationIds.filter(id => !idSet.has(id)),
        })),
      },
    };
  },

  ADD_AI_SEARCH_NEGATIVE_EXAMPLE(
    state: State,
    action: { example: AISearchNegativeExample },
  ) {
    const ex = action.example;
    const dedupeKey = `${ex.documentUri}\0${ex.schemaTag.trim()}\0${ex.query.trim()}\0${ex.quote}`;
    const duplicate = state.aiSearchNegativeExamples.some(e => {
      const k = `${e.documentUri}\0${e.schemaTag.trim()}\0${e.query.trim()}\0${e.quote}`;
      return k === dedupeKey;
    });
    if (duplicate) {
      return state;
    }
    return {
      aiSearchNegativeExamples: [...state.aiSearchNegativeExamples, ex],
    };
  },

  REMOVE_AI_SEARCH_NEGATIVE_EXAMPLE(
    state: State,
    action: { exampleId: string },
  ) {
    return {
      aiSearchNegativeExamples: state.aiSearchNegativeExamples.filter(
        e => e.id !== action.exampleId,
      ),
    };
  },

  HYDRATE_AI_SEARCH_NEGATIVE_EXAMPLES(
    state: State,
    action: { examples: AISearchNegativeExample[] },
  ) {
    return {
      aiSearchNegativeExamples: action.examples,
    };
  },

  SET_EXPERIMENT_LOG(state: State, action: { experimentLog: ExperimentLogState }) {
    return {
      experimentLog: action.experimentLog,
    };
  },

  HYDRATE_EXPERIMENT_LOG(state: State, action: { experimentLog: ExperimentLogState }) {
    return {
      experimentLog: action.experimentLog,
    };
  },

  SET_AI_SEARCH_PUBLIC_DOCUMENT_SCOPE(
    state: State,
    action: { scope: AISearchPublicDocumentScope },
  ) {
    return {
      aiSearchPublicDocumentScope: action.scope,
    };
  },

  PRUNE_AI_SEARCH_ROWS_FOR_GROUP(
    state: State,
    action: { groupId: string; descriptors: AISearchHistoryRowDescriptor[] },
  ) {
    const rows = pruneAISearchRowsToDescriptors(
      state.aiSearch.rows,
      action.descriptors,
      action.groupId,
    );
    // Keep `schemaTagColors` untouched so colors stay stable when a tag is
    // pruned and later reappears (and so user overrides survive a re-sync).
    return {
      aiSearch: { ...state.aiSearch, rows },
    };
  },
};

/**
 * Designate `panelName` as the currently-active panel name
 */
function openSidebarPanel(panelName: PanelName) {
  return makeAction(reducers, 'OPEN_SIDEBAR_PANEL', { panelName });
}

/**
 * `panelName` should not be the active panel
 */
function closeSidebarPanel(panelName: PanelName) {
  return makeAction(reducers, 'CLOSE_SIDEBAR_PANEL', { panelName });
}

/**
 * Toggle a sidebar panel from its current state, or set it to the
 * designated `panelState`.
 *
 * @param panelState -
 *   Should the panel be active? Omit this prop to simply toggle the value.
 */
function toggleSidebarPanel(panelName: PanelName, panelState?: boolean) {
  return makeAction(reducers, 'TOGGLE_SIDEBAR_PANEL', {
    panelName,
    panelState,
  });
}

function addAISearchRow(row: AISearchRow) {
  return makeAction(reducers, 'ADD_AI_SEARCH_ROW', { row });
}

function removeAISearchRow(rowId: string) {
  return makeAction(reducers, 'REMOVE_AI_SEARCH_ROW', { rowId });
}

function setAISearchRowHidden(rowId: string, hidden: boolean) {
  return makeAction(reducers, 'SET_AI_SEARCH_ROW_HIDDEN', { rowId, hidden });
}

function setAISearchSchemaTagColor(schemaTag: string, rgba: string) {
  return makeAction(reducers, 'SET_AI_SEARCH_SCHEMA_TAG_COLOR', {
    schemaTag,
    rgba,
  });
}

function hydrateAISearch(aiSearch: AISearchState) {
  return makeAction(reducers, 'HYDRATE_AI_SEARCH', { aiSearch });
}

function mergeAISearchRowsWithSameTagQuery(keepRowId: string) {
  return makeAction(reducers, 'MERGE_AI_SEARCH_ROWS_SAME_TAG_QUERY', {
    keepRowId,
  });
}

function setAISearchRowAnnotationIds(rowId: string, annotationIds: string[]) {
  return makeAction(reducers, 'SET_AI_SEARCH_ROW_ANNOTATION_IDS', {
    rowId,
    annotationIds,
  });
}

function removeAnnotationIdsFromAISearchRows(annotationIds: string[]) {
  return makeAction(reducers, 'REMOVE_AI_SEARCH_ANNOTATION_IDS', {
    annotationIds,
  });
}

function addAISearchNegativeExample(example: AISearchNegativeExample) {
  return makeAction(reducers, 'ADD_AI_SEARCH_NEGATIVE_EXAMPLE', { example });
}

function removeAISearchNegativeExample(exampleId: string) {
  return makeAction(reducers, 'REMOVE_AI_SEARCH_NEGATIVE_EXAMPLE', {
    exampleId,
  });
}

function hydrateAISearchNegativeExamples(examples: AISearchNegativeExample[]) {
  return makeAction(reducers, 'HYDRATE_AI_SEARCH_NEGATIVE_EXAMPLES', {
    examples,
  });
}

function setExperimentLog(experimentLog: ExperimentLogState) {
  return makeAction(reducers, 'SET_EXPERIMENT_LOG', { experimentLog });
}

function hydrateExperimentLog(experimentLog: ExperimentLogState) {
  return makeAction(reducers, 'HYDRATE_EXPERIMENT_LOG', { experimentLog });
}

function setAISearchPublicDocumentScope(scope: AISearchPublicDocumentScope) {
  return makeAction(reducers, 'SET_AI_SEARCH_PUBLIC_DOCUMENT_SCOPE', { scope });
}

function pruneAISearchRowsForGroup(
  groupId: string,
  descriptors: AISearchHistoryRowDescriptor[],
) {
  return makeAction(reducers, 'PRUNE_AI_SEARCH_ROWS_FOR_GROUP', {
    groupId,
    descriptors,
  });
}

/**
 * Is the panel indicated by `panelName` currently active (open)?
 */
function isSidebarPanelOpen(state: State, panelName: PanelName) {
  return state.activePanelName === panelName;
}

function aiSearchRows(state: State) {
  return state.aiSearch.rows;
}

function aiSearchSchemaTagColors(state: State) {
  return state.aiSearch.schemaTagColors;
}

function aiSearchNegativeExamples(state: State) {
  return state.aiSearchNegativeExamples;
}

function experimentLog(state: State) {
  return state.experimentLog;
}

function aiSearchPublicDocumentScope(state: State) {
  return state.aiSearchPublicDocumentScope;
}

export const sidebarPanelsModule = createStoreModule(initialState, {
  namespace: 'sidebarPanels',
  reducers,

  actionCreators: {
    openSidebarPanel,
    closeSidebarPanel,
    toggleSidebarPanel,
    addAISearchRow,
    removeAISearchRow,
    setAISearchRowHidden,
    setAISearchSchemaTagColor,
    hydrateAISearch,
    mergeAISearchRowsWithSameTagQuery,
    setAISearchRowAnnotationIds,
    removeAnnotationIdsFromAISearchRows,
    addAISearchNegativeExample,
    removeAISearchNegativeExample,
    hydrateAISearchNegativeExamples,
    setExperimentLog,
    hydrateExperimentLog,
    setAISearchPublicDocumentScope,
    pruneAISearchRowsForGroup,
  },

  selectors: {
    isSidebarPanelOpen,
    aiSearchRows,
    aiSearchSchemaTagColors,
    aiSearchNegativeExamples,
    experimentLog,
    aiSearchPublicDocumentScope,
  },
});
