import { mockImportedComponents } from '@hypothesis/frontend-testing';
import { mount } from '@hypothesis/frontend-testing';

import { rowDescriptorKey } from '../../../helpers/ai-search-group-history';
import AISearchPanel, { $imports } from '../AISearchPanel';

describe('AISearchPanel', () => {
  let fakeStore;
  let fakeAiSearchGroupHistorySync;

  beforeEach(() => {
    fakeStore = {
      aiSearchPanelQueryInput: sinon.stub().returns('query text'),
      aiSearchPanelSchemaTagInput: sinon.stub().returns(''),
      aiSearchPanelAnnotateManually: sinon.stub().returns(false),
      aiSearchRows: sinon.stub().returns([]),
      savedAnnotations: sinon.stub().returns([]),
      aiSearchSchemaTagColors: sinon.stub().returns({}),
      searchUris: sinon.stub().returns([]),
      aiSearchNegativeExamples: sinon.stub().returns([]),
      focusedGroupId: sinon.stub().returns('group-1'),
      aiSearchPublicDocumentScope: sinon.stub().returns(null),
      closeSidebarPanel: sinon.stub(),
      setAISearchPanelQueryInput: sinon.stub(),
      setFilterQuery: sinon.stub(),
      setAISearchPanelSchemaTagInput: sinon.stub(),
      setAISearchPanelAnnotateManually: sinon.stub(),
      setAISearchSchemaTagColor: sinon.stub(),
      setAISearchRowHidden: sinon.stub(),
    };

    fakeAiSearchGroupHistorySync = {
      syncGroupHistory: sinon.stub().resolves(),
    };

    $imports.$mock(mockImportedComponents());
    $imports.$mock({
      '../../store': {
        useSidebarStore: () => fakeStore,
      },
    });
  });

  afterEach(() => {
    $imports.$restore();
  });

  function createAISearchPanel() {
    return mount(
      <AISearchPanel
        annotationsService={{}}
        experimentLog={{}}
        frameSync={{ setTagHighlightPalette: sinon.stub() }}
        claude={{ firstPDFURI: sinon.stub().returns(null) }}
        api={{}}
        toastMessenger={{}}
        aiSearchGroupHistorySync={fakeAiSearchGroupHistorySync}
      />,
    );
  }

  /** Tag labels of the rendered history rows, in DOM (display) order. */
  function renderedTagOrder(wrapper) {
    return wrapper
      .find('button')
      .filterWhere(n =>
        (n.prop('aria-label') || '').startsWith(
          'Filter sidebar to annotations tagged',
        ),
      )
      .map(n => n.text());
  }

  function refreshButton(wrapper) {
    return wrapper.find(
      'button[data-testid="ai-search-refresh-group-tags"]',
    );
  }

  it('clears query text without closing the panel when clear is clicked', () => {
    const wrapper = createAISearchPanel();

    wrapper.find('SearchField').props().onClearSearch();

    assert.calledWith(fakeStore.setAISearchPanelQueryInput, null);
    assert.notCalled(fakeStore.closeSidebarPanel);
  });

  it('closes AI search panel when Escape is pressed in search field', () => {
    const wrapper = createAISearchPanel();

    wrapper
      .find('SearchField')
      .props()
      .onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));

    assert.calledWith(fakeStore.closeSidebarPanel, 'aiSearchAnnotations');
  });

  it('shows empty-query explanation for manual-mode-style rows', () => {
    fakeStore.aiSearchRows.returns([
      {
        id: 'manual-save-a1-methods',
        groupId: 'group-1',
        schemaTag: 'methods',
        query: '',
        annotationIds: [],
      },
    ]);

    const wrapper = createAISearchPanel();

    assert.include(
      wrapper.text(),
      'No query - matches this tag across the document',
    );
  });

  it('sorts visible history rows alphabetically by tag', () => {
    fakeStore.aiSearchRows.returns([
      { id: 'z', groupId: 'group-1', schemaTag: 'zeta', query: '', annotationIds: [] },
      { id: 'a', groupId: 'group-1', schemaTag: 'alpha', query: '', annotationIds: [] },
      { id: 'm', groupId: 'group-1', schemaTag: 'mu', query: '', annotationIds: [] },
    ]);

    const wrapper = createAISearchPanel();

    assert.deepEqual(renderedTagOrder(wrapper), ['alpha', 'mu', 'zeta']);
  });

  it('hides rows that belong to other groups', () => {
    fakeStore.aiSearchRows.returns([
      { id: 'in', groupId: 'group-1', schemaTag: 'methods', query: '', annotationIds: [] },
      { id: 'out', groupId: 'group-2', schemaTag: 'results', query: '', annotationIds: [] },
    ]);

    const wrapper = createAISearchPanel();

    assert.deepEqual(renderedTagOrder(wrapper), ['methods']);
  });

  it('refreshes group tags when the refresh button is clicked', () => {
    fakeStore.aiSearchRows.returns([
      { id: 'r', groupId: 'group-1', schemaTag: 'methods', query: '', annotationIds: [] },
    ]);

    const wrapper = createAISearchPanel();
    const button = refreshButton(wrapper);

    assert.isNotTrue(button.prop('disabled'));
    button.simulate('click');

    assert.calledWith(fakeAiSearchGroupHistorySync.syncGroupHistory, {
      mode: 'auto',
    });
  });

  it('shows the refresh control even when a private group has no rows', () => {
    fakeStore.aiSearchRows.returns([]);

    const wrapper = createAISearchPanel();
    const button = refreshButton(wrapper);

    assert.isTrue(button.exists());
    assert.isNotTrue(button.prop('disabled'));
    assert.include(wrapper.text(), 'No AI search tags found in this group yet.');
  });

  it('hides the history section for an empty public group', () => {
    fakeStore.focusedGroupId.returns('__world__');
    fakeStore.aiSearchPublicDocumentScope.returns(null);
    fakeStore.aiSearchRows.returns([]);

    const wrapper = createAISearchPanel();

    assert.isFalse(refreshButton(wrapper).exists());
  });

  it('disables the refresh button and skips sync for the public group', () => {
    fakeStore.focusedGroupId.returns('__world__');
    fakeStore.aiSearchPublicDocumentScope.returns({
      documentUri: 'http://example.com',
      visibleDescriptorKeys: [rowDescriptorKey('methods', '')],
    });
    fakeStore.aiSearchRows.returns([
      { id: 'r', groupId: '__world__', schemaTag: 'methods', query: '', annotationIds: [] },
    ]);

    const wrapper = createAISearchPanel();
    const button = refreshButton(wrapper);

    assert.isTrue(button.prop('disabled'));
    button.simulate('click');
    assert.notCalled(fakeAiSearchGroupHistorySync.syncGroupHistory);
  });
});
