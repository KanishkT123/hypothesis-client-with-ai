import { createStore } from '../../create-store';
import { sidebarPanelsModule } from '../sidebar-panels';

describe('sidebar/store/modules/sidebar-panels', () => {
  let store;

  const getSidebarPanelsState = () => {
    return store.getState().sidebarPanels;
  };

  beforeEach(() => {
    store = createStore([sidebarPanelsModule]);
  });

  describe('#initialState', () => {
    it('sets initial `activePanelName` to `null`', () => {
      assert.equal(getSidebarPanelsState().activePanelName, null);
    });

    it('sets initial `aiSearch` rows and colors empty', () => {
      const ai = getSidebarPanelsState().aiSearch;
      assert.deepEqual(ai.rows, []);
      assert.deepEqual(ai.schemaTagColors, {});
    });
  });

  describe('reducers', () => {
    describe('#OPEN_SIDEBAR_PANEL', () => {
      it('replaces `activePanelName` with passed `panelName`', () => {
        store.openSidebarPanel('foobar');

        assert.equal(getSidebarPanelsState().activePanelName, 'foobar');
      });
    });

    describe('#CLOSE_SIDEBAR_PANEL', () => {
      it('sets the active panel `null` if passed `panelName` is active panel', () => {
        store.openSidebarPanel('dingdong');
        store.closeSidebarPanel('dingdong');
        assert.equal(getSidebarPanelsState().activePanelName, null);
      });
      it('does not change the active panel if passed `panelName` is not the active panel', () => {
        store.openSidebarPanel('dingdong');
        store.closeSidebarPanel('somethingelse');
        assert.equal(getSidebarPanelsState().activePanelName, 'dingdong');
      });
    });

    describe('#TOGGLE_SIDEBAR_PANEL', () => {
      it('sets active panel to passed `panelName` if that panel is not the active panel already', () => {
        store.toggleSidebarPanel('dingdong');
        assert.equal(getSidebarPanelsState().activePanelName, 'dingdong');
      });

      it('sets active panel to `null` if passed `panelName` is the active panel already', () => {
        store.openSidebarPanel('dingdong');
        store.toggleSidebarPanel('dingdong');
        assert.equal(getSidebarPanelsState().activePanelName, null);
      });

      it('activates the given `panelName` if `activeState` is `true`', () => {
        store.openSidebarPanel('dingdong');
        store.toggleSidebarPanel('dingdong', true);
        assert.equal(getSidebarPanelsState().activePanelName, 'dingdong');
      });

      it('deactivates the given `panelName` if `activeState` is `false` and panel is active', () => {
        store.openSidebarPanel('dingdong');
        store.toggleSidebarPanel('dingdong', false);
        assert.equal(getSidebarPanelsState().activePanelName, null);
      });

      it('does not change active panel if `panelName` is not active and `activeState` is false', () => {
        store.openSidebarPanel('doodledoo');
        store.toggleSidebarPanel('dingdong', false);
        assert.equal(getSidebarPanelsState().activePanelName, 'doodledoo');
      });
    });
  });

  describe('aiSearch reducers', () => {
    it('adds a row and assigns a default color for a new schema tag', () => {
      store.addAISearchRow({
        id: 'r1',
        schemaTag: 'methods',
        query: 'q1',
        annotationIds: ['a1'],
      });
      const ai = getSidebarPanelsState().aiSearch;
      assert.lengthOf(ai.rows, 1);
      assert.equal(ai.rows[0].schemaTag, 'methods');
      assert.include(ai.schemaTagColors.methods, 'rgba(');
    });

    it('does not duplicate default color when adding another row for the same tag', () => {
      store.addAISearchRow({
        id: 'r1',
        schemaTag: 't',
        query: 'q1',
        annotationIds: [],
      });
      const first = getSidebarPanelsState().aiSearch.schemaTagColors.t;
      store.addAISearchRow({
        id: 'r2',
        schemaTag: 't',
        query: 'q2',
        annotationIds: [],
      });
      assert.equal(
        getSidebarPanelsState().aiSearch.schemaTagColors.t,
        first,
      );
    });

    it('removes a row and prunes color when no rows use that tag', () => {
      store.addAISearchRow({
        id: 'r1',
        schemaTag: 'x',
        query: 'q',
        annotationIds: [],
      });
      assert.property(getSidebarPanelsState().aiSearch.schemaTagColors, 'x');
      store.removeAISearchRow('r1');
      assert.notProperty(getSidebarPanelsState().aiSearch.schemaTagColors, 'x');
    });

    it('updates schema tag color', () => {
      store.addAISearchRow({
        id: 'r1',
        schemaTag: 'z',
        query: 'q',
        annotationIds: [],
      });
      store.setAISearchSchemaTagColor('z', 'rgba(1, 2, 3, 0.38)');
      assert.equal(
        getSidebarPanelsState().aiSearch.schemaTagColors.z,
        'rgba(1, 2, 3, 0.38)',
      );
    });
  });

  describe('selectors', () => {
    describe('#isSidebarPanelOpen', () => {
      it('returns `true` if `panelName` is the current active panel', () => {
        store.openSidebarPanel('dingdong');
        assert.isTrue(store.isSidebarPanelOpen('dingdong'));
      });

      it('returns `false` if `panelName` is not the current active panel', () => {
        store.openSidebarPanel('dingdong');
        assert.isFalse(store.isSidebarPanelOpen('broomstick'));
      });
    });

    describe('#aiSearchRows and #aiSearchSchemaTagColors', () => {
      it('returns current aiSearch slice fields', () => {
        store.addAISearchRow({
          id: 'id1',
          schemaTag: 's',
          query: 'qq',
          annotationIds: ['id'],
        });
        assert.lengthOf(store.aiSearchRows(), 1);
        assert.property(store.aiSearchSchemaTagColors(), 's');
      });
    });
  });
});
