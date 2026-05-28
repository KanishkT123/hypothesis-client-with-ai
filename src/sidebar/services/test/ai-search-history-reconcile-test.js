import sinon from 'sinon';

import { rowDescriptorKey } from '../../helpers/ai-search-group-history';
import {
  applyDerivedAISearchHistoryRows,
  loadSyncRowID,
  reconcileAISearchHistoryRowsFromAnnotations,
} from '../ai-search-history-reconcile';

describe('reconcileAISearchHistoryRowsFromAnnotations', () => {
  let fakeStore;

  beforeEach(() => {
    fakeStore = {
      addAISearchRow: sinon.stub(),
      aiSearchRows: sinon.stub().returns([]),
      mergeAISearchRowsWithSameTagQuery: sinon.stub(),
      savedAnnotations: sinon.stub(),
      focusedGroupId: sinon.stub().returns('group-a'),
      searchUris: sinon.stub().returns(['http://example.com']),
      mainFrame: sinon.stub().returns({ uri: 'http://example.com' }),
      setAISearchPublicDocumentScope: sinon.stub(),
    };
  });

  it('adds missing rows for schema tags found in annotations', () => {
    fakeStore.savedAnnotations.returns([
      { id: 'a1', group: 'group-a', uri: 'http://example.com', tags: ['methods'] },
      {
        id: 'a2',
        group: 'group-a',
        uri: 'http://example.com',
        tags: ['results'],
      },
    ]);

    reconcileAISearchHistoryRowsFromAnnotations(fakeStore);

    assert.calledWith(fakeStore.addAISearchRow, {
      id: loadSyncRowID('methods', ''),
      groupId: 'group-a',
      schemaTag: 'methods',
      query: '',
      annotationIds: [],
    });
    assert.calledWith(fakeStore.addAISearchRow, {
      id: loadSyncRowID('results', ''),
      groupId: 'group-a',
      schemaTag: 'results',
      query: '',
      annotationIds: [],
    });
  });

  it('uses query text from ai-user-approved annotations', () => {
    fakeStore.savedAnnotations.returns([
      {
        id: 'a1',
        group: 'group-a',
        uri: 'http://example.com',
        tags: ['methods', 'ai-user-approved'],
        text: '  find methods  ',
      },
    ]);

    reconcileAISearchHistoryRowsFromAnnotations(fakeStore);

    assert.calledWith(fakeStore.addAISearchRow, {
      id: loadSyncRowID('methods', 'find methods'),
      groupId: 'group-a',
      schemaTag: 'methods',
      query: 'find methods',
      annotationIds: [],
    });
  });

  it('does not add a duplicate row when matching row already exists', () => {
    fakeStore.savedAnnotations.returns([
      {
        id: 'a1',
        group: 'group-a',
        uri: 'http://example.com',
        tags: ['methods'],
      },
    ]);
    fakeStore.aiSearchRows.returns([
      {
        id: 'existing-row',
        groupId: 'group-a',
        schemaTag: 'methods',
        query: '',
        annotationIds: [],
      },
    ]);

    reconcileAISearchHistoryRowsFromAnnotations(fakeStore);

    assert.notCalled(fakeStore.addAISearchRow);
    assert.calledWith(
      fakeStore.mergeAISearchRowsWithSameTagQuery,
      'existing-row',
    );
  });

  it('ignores annotations from other groups or URIs', () => {
    fakeStore.savedAnnotations.returns([
      {
        id: 'a1',
        group: 'other-group',
        uri: 'http://example.com',
        tags: ['methods'],
      },
      {
        id: 'a2',
        group: 'group-a',
        uri: 'http://other.com',
        tags: ['results'],
      },
    ]);

    reconcileAISearchHistoryRowsFromAnnotations(fakeStore);

    assert.notCalled(fakeStore.addAISearchRow);
  });

  it('ignores system tags and pending annotations but keeps manual tags', () => {
    fakeStore.savedAnnotations.returns([
      {
        id: 'a1',
        group: 'group-a',
        uri: 'http://example.com',
        tags: ['ai-pending', '  ', ''],
      },
      {
        id: 'a2',
        group: 'group-a',
        uri: 'http://example.com',
        tags: ['ai-user-approved'],
      },
      {
        id: 'a3',
        group: 'group-a',
        uri: 'http://example.com',
        tags: ['methods', 'ai-pending'],
      },
      {
        id: 'a4',
        group: 'group-a',
        uri: 'http://example.com',
        tags: ['results'],
      },
    ]);

    reconcileAISearchHistoryRowsFromAnnotations(fakeStore);

    assert.calledOnce(fakeStore.addAISearchRow);
    assert.calledWith(fakeStore.addAISearchRow, {
      id: loadSyncRowID('results', ''),
      groupId: 'group-a',
      schemaTag: 'results',
      query: '',
      annotationIds: [],
    });
  });
});

describe('applyDerivedAISearchHistoryRows', () => {
  it('updates Public document scope keys', () => {
    const fakeStore = {
      addAISearchRow: sinon.stub(),
      aiSearchRows: sinon.stub().returns([]),
      mergeAISearchRowsWithSameTagQuery: sinon.stub(),
      setAISearchPublicDocumentScope: sinon.stub(),
    };

    applyDerivedAISearchHistoryRows(fakeStore, {
      groupId: '__world__',
      documentUri: 'http://example.com',
      updatePublicScope: true,
      annotations: [
        {
          id: 'a1',
          group: '__world__',
          uri: 'http://example.com',
          tags: ['methods', 'ai-user-approved'],
          text: 'q1',
        },
      ],
    });

    assert.calledWith(fakeStore.setAISearchPublicDocumentScope, {
      documentUri: 'http://example.com',
      visibleDescriptorKeys: [rowDescriptorKey('methods', 'q1')],
    });
  });
});
