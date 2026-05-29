import sinon from 'sinon';

import { fakeReduxStore } from '../../test/fake-redux-store';
import { setupAISearchTagPaletteSync } from '../ai-search-tag-palette-sync';

describe('setupAISearchTagPaletteSync', () => {
  function createStore(aiSearch, { focusedGroupId = 'group-1', publicScope = null } = {}) {
    return fakeReduxStore(
      {
        sidebarPanels: {
          aiSearch,
        },
      },
      {
        focusedGroupId: () => focusedGroupId,
        aiSearchPublicDocumentScope: () => publicScope,
      },
    );
  }

  it('pushes palette using visible rows only on setup', () => {
    const frameSync = {
      setTagHighlightPalette: sinon.stub(),
    };
    const store = createStore({
      rows: [
        {
          id: 'r1',
          groupId: 'group-1',
          schemaTag: 'topic',
          query: '',
          annotationIds: [],
        },
      ],
      schemaTagColors: { topic: 'rgba(1, 2, 3, 0.38)' },
    });

    setupAISearchTagPaletteSync(frameSync, store);

    assert.calledOnce(frameSync.setTagHighlightPalette);
    assert.deepEqual(frameSync.setTagHighlightPalette.firstCall.args[0], {
      'ai-pending': 'rgba(64, 169, 255, 0.38)',
      'ai-user-approved': 'rgba(255, 64, 223, 0.38)',
      topic: 'rgba(1, 2, 3, 0.38)',
    });
  });

  it('re-pushes palette when a row is hidden or unhidden', () => {
    const frameSync = {
      setTagHighlightPalette: sinon.stub(),
    };
    const store = createStore({
      rows: [
        {
          id: 'r1',
          groupId: 'group-1',
          schemaTag: 'topic',
          query: '',
          annotationIds: [],
        },
      ],
      schemaTagColors: { topic: 'rgba(1, 2, 3, 0.38)' },
    });

    setupAISearchTagPaletteSync(frameSync, store);

    store.setState({
      sidebarPanels: {
        aiSearch: {
          rows: [
            {
              id: 'r1',
              groupId: 'group-1',
              schemaTag: 'topic',
              query: '',
              annotationIds: [],
              hidden: true,
            },
          ],
          schemaTagColors: { topic: 'rgba(1, 2, 3, 0.38)' },
        },
      },
    });
    store.setState({
      sidebarPanels: {
        aiSearch: {
          rows: [
            {
              id: 'r1',
              groupId: 'group-1',
              schemaTag: 'topic',
              query: '',
              annotationIds: [],
            },
          ],
          schemaTagColors: { topic: 'rgba(1, 2, 3, 0.38)' },
        },
      },
    });

    assert.equal(frameSync.setTagHighlightPalette.callCount, 3);
    assert.notProperty(frameSync.setTagHighlightPalette.getCall(1).args[0], 'topic');
    assert.propertyVal(
      frameSync.setTagHighlightPalette.getCall(2).args[0],
      'topic',
      'rgba(1, 2, 3, 0.38)',
    );
  });
});
