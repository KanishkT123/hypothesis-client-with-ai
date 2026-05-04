import { mockImportedComponents } from '@hypothesis/frontend-testing';
import { mount } from '@hypothesis/frontend-testing';

import AISearchPanel, { $imports } from '../AISearchPanel';

describe('AISearchPanel', () => {
  let fakeStore;

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
      closeSidebarPanel: sinon.stub(),
      setAISearchPanelQueryInput: sinon.stub(),
      setFilterQuery: sinon.stub(),
      setAISearchPanelSchemaTagInput: sinon.stub(),
      setAISearchPanelAnnotateManually: sinon.stub(),
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
      />,
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
});
