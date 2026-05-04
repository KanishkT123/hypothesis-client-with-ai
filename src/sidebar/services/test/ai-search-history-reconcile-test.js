import sinon from 'sinon';

import { reconcileAISearchHistoryRowsFromAnnotations } from '../ai-search-history-reconcile';

describe('reconcileAISearchHistoryRowsFromAnnotations', () => {
  let fakeStore;

  beforeEach(() => {
    fakeStore = {
      addAISearchRow: sinon.stub(),
      aiSearchRows: sinon.stub().returns([]),
      mergeAISearchRowsWithSameTagQuery: sinon.stub(),
      savedAnnotations: sinon.stub(),
    };
  });

  it('adds missing rows for schema tags found in annotations', () => {
    fakeStore.savedAnnotations.returns([
      { id: 'a1', tags: ['methods'] },
      { id: 'a2', tags: ['results'] },
    ]);

    reconcileAISearchHistoryRowsFromAnnotations(fakeStore);

    assert.calledWith(fakeStore.addAISearchRow, {
      id: 'load-sync-methods',
      schemaTag: 'methods',
      query: '',
      annotationIds: [],
    });
    assert.calledWith(fakeStore.addAISearchRow, {
      id: 'load-sync-results',
      schemaTag: 'results',
      query: '',
      annotationIds: [],
    });
    assert.calledWith(
      fakeStore.mergeAISearchRowsWithSameTagQuery,
      'load-sync-methods',
    );
    assert.calledWith(
      fakeStore.mergeAISearchRowsWithSameTagQuery,
      'load-sync-results',
    );
  });

  it('does not add a duplicate row when matching empty-query row already exists', () => {
    fakeStore.savedAnnotations.returns([{ id: 'a1', tags: ['methods'] }]);
    fakeStore.aiSearchRows.returns([
      {
        id: 'existing-row',
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

  it('ignores system tags and empty tags', () => {
    fakeStore.savedAnnotations.returns([
      { id: 'a1', tags: ['ai-pending', '  ', ''] },
      { id: 'a2', tags: ['ai-user-approved'] },
      { id: 'a3', tags: ['methods', 'ai-pending'] },
    ]);

    reconcileAISearchHistoryRowsFromAnnotations(fakeStore);

    assert.calledOnce(fakeStore.addAISearchRow);
    assert.calledWith(fakeStore.addAISearchRow, {
      id: 'load-sync-methods',
      schemaTag: 'methods',
      query: '',
      annotationIds: [],
    });
  });

  it('creates a single row for repeated tag values', () => {
    fakeStore.savedAnnotations.returns([
      { id: 'a1', tags: ['methods'] },
      { id: 'a2', tags: ['methods', 'methods'] },
      { id: 'a3', tags: [' methods '] },
    ]);

    reconcileAISearchHistoryRowsFromAnnotations(fakeStore);

    assert.calledOnce(fakeStore.addAISearchRow);
    assert.calledWith(fakeStore.addAISearchRow, {
      id: 'load-sync-methods',
      schemaTag: 'methods',
      query: '',
      annotationIds: [],
    });
  });
});
