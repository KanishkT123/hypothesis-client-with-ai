import { createStore } from '../../create-store';
import { rowDescriptorKey } from '../../../helpers/tag-inventory-group';
import { isTagInventoryRowVisibleInScope } from '../../../helpers/tag-inventory-group';
import { PUBLIC_GROUP_ID } from '../../../helpers/groups';
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

    it('sets initial `tagInventory` rows and colors empty', () => {
      const ai = getSidebarPanelsState().tagInventory;
      assert.deepEqual(ai.rows, []);
      assert.deepEqual(ai.schemaTagColors, {});
    });

    it('sets initial `experimentLog` to empty version-1 state', () => {
      const log = getSidebarPanelsState().experimentLog;
      assert.deepEqual(log, {
        version: 1,
        events: [],
      });
    });
    it('sets initial `tagInventoryPublicDocumentScope` to null', () => {
      assert.isNull(getSidebarPanelsState().tagInventoryPublicDocumentScope);
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

  describe('tagInventory reducers', () => {
    it('prepends newly added rows to the top of history', () => {
      store.addTagInventoryRow({
        id: 'older',
        schemaTag: 'methods',
        query: 'q1',
        annotationIds: [],
      });
      store.addTagInventoryRow({
        id: 'newer',
        schemaTag: 'results',
        query: 'q2',
        annotationIds: [],
      });

      const rows = getSidebarPanelsState().tagInventory.rows;
      assert.deepEqual(rows.map(r => r.id), ['newer', 'older']);
    });

    it('adds a row and assigns a default color for a new schema tag', () => {
      store.addTagInventoryRow({
        id: 'r1',
        schemaTag: 'methods',
        query: 'q1',
        annotationIds: ['a1'],
      });
      const ai = getSidebarPanelsState().tagInventory;
      assert.lengthOf(ai.rows, 1);
      assert.equal(ai.rows[0].schemaTag, 'methods');
      assert.include(ai.schemaTagColors.methods, 'rgba(');
    });

    it('does not duplicate default color when adding another row for the same tag', () => {
      store.addTagInventoryRow({
        id: 'r1',
        schemaTag: 't',
        query: 'q1',
        annotationIds: [],
      });
      const first = getSidebarPanelsState().tagInventory.schemaTagColors.t;
      store.addTagInventoryRow({
        id: 'r2',
        schemaTag: 't',
        query: 'q2',
        annotationIds: [],
      });
      assert.equal(
        getSidebarPanelsState().tagInventory.schemaTagColors.t,
        first,
      );
    });

    it('removes a row but keeps the tag color sticky', () => {
      store.addTagInventoryRow({
        id: 'r1',
        schemaTag: 'x',
        query: 'q',
        annotationIds: [],
      });
      store.setTagInventorySchemaTagColor('x', 'rgba(9, 9, 9, 0.38)');
      store.removeTagInventoryRow('r1');
      // Color is retained so a re-added 'x' row reuses the same (overridden) color.
      assert.equal(
        getSidebarPanelsState().tagInventory.schemaTagColors.x,
        'rgba(9, 9, 9, 0.38)',
      );
    });

    it('updates schema tag color', () => {
      store.addTagInventoryRow({
        id: 'r1',
        schemaTag: 'z',
        query: 'q',
        annotationIds: [],
      });
      store.setTagInventorySchemaTagColor('z', 'rgba(1, 2, 3, 0.38)');
      assert.equal(
        getSidebarPanelsState().tagInventory.schemaTagColors.z,
        'rgba(1, 2, 3, 0.38)',
      );
    });

    it('merges duplicate tag+query rows into keep row and unions annotation ids', () => {
      store.addTagInventoryRow({
        id: 'keep',
        schemaTag: 't',
        query: 'q1',
        annotationIds: ['a1'],
      });
      store.addTagInventoryRow({
        id: 'dup',
        schemaTag: 't',
        query: 'q1',
        annotationIds: ['a2', 'a1'],
      });
      store.addTagInventoryRow({
        id: 'other',
        schemaTag: 'u',
        query: 'q2',
        annotationIds: ['x'],
      });
      store.mergeTagInventoryRowsWithSameTagQuery('keep');
      const ai = getSidebarPanelsState().tagInventory;
      assert.lengthOf(ai.rows, 2);
      const merged = ai.rows.find(r => r.id === 'keep');
      assert.deepEqual(merged.annotationIds, ['a1', 'a2']);
      assert.isTrue(ai.rows.some(r => r.id === 'other'));
    });

    it('merge with trim-equivalent tag and query still merges', () => {
      store.addTagInventoryRow({
        id: 'k',
        schemaTag: ' tag ',
        query: ' q ',
        annotationIds: ['1'],
      });
      store.addTagInventoryRow({
        id: 'd',
        schemaTag: 'tag',
        query: 'q',
        annotationIds: ['2'],
      });
      store.mergeTagInventoryRowsWithSameTagQuery('k');
      assert.lengthOf(getSidebarPanelsState().tagInventory.rows, 1);
    });

    it('sets and clears row hidden flag', () => {
      store.addTagInventoryRow({
        id: 'r1',
        schemaTag: 's',
        query: 'q',
        annotationIds: [],
      });
      store.setTagInventoryRowHidden('r1', true);
      let row = getSidebarPanelsState().tagInventory.rows[0];
      assert.isTrue(row.hidden);
      store.setTagInventoryRowHidden('r1', false);
      row = getSidebarPanelsState().tagInventory.rows[0];
      assert.notProperty(row, 'hidden');
    });

    it('merge clears hidden when any duplicate is non-hidden', () => {
      store.addTagInventoryRow({
        id: 'keep',
        schemaTag: 't',
        query: 'q',
        annotationIds: ['a1'],
        hidden: true,
      });
      store.addTagInventoryRow({
        id: 'dup',
        schemaTag: 't',
        query: 'q',
        annotationIds: ['a2'],
      });
      store.mergeTagInventoryRowsWithSameTagQuery('keep');
      const merged = getSidebarPanelsState().tagInventory.rows[0];
      assert.notProperty(merged, 'hidden');
    });

    it('merge keeps hidden when every duplicate is hidden', () => {
      store.addTagInventoryRow({
        id: 'keep',
        schemaTag: 't',
        query: 'q',
        annotationIds: ['a1'],
        hidden: true,
      });
      store.addTagInventoryRow({
        id: 'dup',
        schemaTag: 't',
        query: 'q',
        annotationIds: ['a2'],
        hidden: true,
      });
      store.mergeTagInventoryRowsWithSameTagQuery('keep');
      const merged = getSidebarPanelsState().tagInventory.rows[0];
      assert.isTrue(merged.hidden);
    });

    it('sets annotation ids on a single row', () => {
      store.addTagInventoryRow({
        id: 'r1',
        schemaTag: 's',
        query: 'q',
        annotationIds: ['old'],
      });
      store.setTagInventoryRowAnnotationIds('r1', ['n1', 'n2']);
      assert.deepEqual(
        getSidebarPanelsState().tagInventory.rows[0].annotationIds,
        ['n1', 'n2'],
      );
    });

    it('removes annotation ids from all rows', () => {
      store.addTagInventoryRow({
        id: 'r1',
        schemaTag: 'a',
        query: 'q1',
        annotationIds: ['x', 'y'],
      });
      store.addTagInventoryRow({
        id: 'r2',
        schemaTag: 'b',
        query: 'q2',
        annotationIds: ['y', 'z'],
      });
      store.removeAnnotationIdsFromTagInventoryRows(['y']);
      const rows = getSidebarPanelsState().tagInventory.rows;
      assert.deepEqual(
        rows.find(r => r.id === 'r1').annotationIds,
        ['x'],
      );
      assert.deepEqual(
        rows.find(r => r.id === 'r2').annotationIds,
        ['z'],
      );
    });

    describe('#HYDRATE_TAG_INVENTORY', () => {
      it('replaces the full tagInventory slice', () => {
        store.addTagInventoryRow({
          id: 'r1',
          schemaTag: 'tag',
          query: 'q',
          annotationIds: [],
        });
        const replacement = {
          rows: [
            {
              id: 'x',
              schemaTag: 'a',
              query: 'b',
              annotationIds: ['id1'],
            },
          ],
          schemaTagColors: { a: 'rgba(1,1,1,0.38)' },
        };
        store.hydrateTagInventory(replacement);
        assert.deepEqual(getSidebarPanelsState().tagInventory, replacement);
      });

      it('does not change activePanelName', () => {
        store.openSidebarPanel('aiSearchAnnotations');
        store.hydrateTagInventory({
          rows: [],
          schemaTagColors: {},
        });
        assert.equal(
          getSidebarPanelsState().activePanelName,
          'aiSearchAnnotations',
        );
      });
    });

    describe('#PRUNE_TAG_INVENTORY_ROWS_FOR_GROUP', () => {
      it('removes in-group rows missing from descriptors but keeps other groups', () => {
        store.addTagInventoryRow({
          id: 'keep',
          groupId: 'group-a',
          schemaTag: 'methods',
          query: '',
          annotationIds: [],
        });
        store.addTagInventoryRow({
          id: 'drop',
          groupId: 'group-a',
          schemaTag: 'old',
          query: '',
          annotationIds: [],
        });
        store.addTagInventoryRow({
          id: 'other-group',
          groupId: 'group-b',
          schemaTag: 'old',
          query: '',
          annotationIds: [],
        });

        store.pruneTagInventoryRowsForGroup('group-a', [
          { schemaTag: 'methods', query: '' },
        ]);

        const ids = store.tagInventoryRows().map(r => r.id);
        assert.sameMembers(ids, ['keep', 'other-group']);
      });

      it('keeps tag colors sticky after pruning', () => {
        store.addTagInventoryRow({
          id: 'drop',
          groupId: 'group-a',
          schemaTag: 'old',
          query: '',
          annotationIds: [],
        });
        store.setTagInventorySchemaTagColor('old', 'rgba(7, 7, 7, 0.38)');

        store.pruneTagInventoryRowsForGroup('group-a', [
          { schemaTag: 'methods', query: '' },
        ]);

        assert.equal(
          getSidebarPanelsState().tagInventory.schemaTagColors.old,
          'rgba(7, 7, 7, 0.38)',
        );
      });
    });

    describe('#SET_TAG_INVENTORY_PUBLIC_DOCUMENT_SCOPE', () => {
      it('stores Public document visibility keys', () => {
        store.setTagInventoryPublicDocumentScope({
          documentUri: 'http://example.com',
          visibleDescriptorKeys: [rowDescriptorKey('methods', '')],
        });

        assert.deepEqual(store.tagInventoryPublicDocumentScope(), {
          documentUri: 'http://example.com',
          visibleDescriptorKeys: [rowDescriptorKey('methods', '')],
        });
      });
    });

    describe('group-scoped row visibility', () => {
      it('shows private rows only for matching focused group', () => {
        const row = {
          id: 'r1',
          groupId: 'group-a',
          schemaTag: 'methods',
          query: '',
          annotationIds: [],
        };

        assert.isTrue(
          isTagInventoryRowVisibleInScope(row, { focusedGroupId: 'group-a' }),
        );
        assert.isFalse(
          isTagInventoryRowVisibleInScope(row, { focusedGroupId: 'group-b' }),
        );
      });

      it('shows Public rows only when descriptor key is in document scope', () => {
        const row = {
          id: 'r1',
          groupId: PUBLIC_GROUP_ID,
          schemaTag: 'methods',
          query: '',
          annotationIds: [],
        };
        const key = rowDescriptorKey('methods', '');

        assert.isTrue(
          isTagInventoryRowVisibleInScope(row, {
            focusedGroupId: PUBLIC_GROUP_ID,
            publicDocumentDescriptorKeys: new Set([key]),
          }),
        );
        assert.isFalse(
          isTagInventoryRowVisibleInScope(row, {
            focusedGroupId: PUBLIC_GROUP_ID,
            publicDocumentDescriptorKeys: new Set(),
          }),
        );
      });
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

    describe('#tagInventoryRows and #tagInventorySchemaTagColors', () => {
      it('returns current tagInventory slice fields', () => {
        store.addTagInventoryRow({
          id: 'id1',
          schemaTag: 's',
          query: 'qq',
          annotationIds: ['id'],
        });
        assert.lengthOf(store.tagInventoryRows(), 1);
        assert.property(store.tagInventorySchemaTagColors(), 's');
      });
    });
  });
});
