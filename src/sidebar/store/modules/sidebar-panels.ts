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
import { createStoreModule, makeAction } from '../create-store';

export type AISearchRow = {
  id: string;
  schemaTag: string;
  query: string;
  annotationIds: string[];
};

export type AISearchState = {
  rows: AISearchRow[];
  schemaTagColors: Record<string, string>;
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
};

const initialAiSearch: AISearchState = {
  rows: [],
  schemaTagColors: {},
};

const initialState: State = {
  activePanelName: null,
  aiSearch: initialAiSearch, //TODO: Rename
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
    const rows = [...state.aiSearch.rows, row];
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

  REMOVE_AI_SEARCH_ROW(state: State, action: { rowId: string }) {
    const removed = state.aiSearch.rows.find(r => r.id === action.rowId);
    const rows = state.aiSearch.rows.filter(r => r.id !== action.rowId);
    let { schemaTagColors } = state.aiSearch;
    if (removed) {
      const tag = removed.schemaTag.trim();
      if (tag && !rows.some(r => r.schemaTag.trim() === tag)) {
        const next = { ...schemaTagColors };
        delete next[tag];
        schemaTagColors = next;
      }
    }
    return {
      aiSearch: { rows, schemaTagColors },
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

function setAISearchSchemaTagColor(schemaTag: string, rgba: string) {
  return makeAction(reducers, 'SET_AI_SEARCH_SCHEMA_TAG_COLOR', {
    schemaTag,
    rgba,
  });
}

function hydrateAISearch(aiSearch: AISearchState) {
  return makeAction(reducers, 'HYDRATE_AI_SEARCH', { aiSearch });
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

export const sidebarPanelsModule = createStoreModule(initialState, {
  namespace: 'sidebarPanels',
  reducers,

  actionCreators: {
    openSidebarPanel,
    closeSidebarPanel,
    toggleSidebarPanel,
    addAISearchRow,
    removeAISearchRow,
    setAISearchSchemaTagColor,
    hydrateAISearch,
  },

  selectors: {
    isSidebarPanelOpen,
    aiSearchRows,
    aiSearchSchemaTagColors,
  },
});
