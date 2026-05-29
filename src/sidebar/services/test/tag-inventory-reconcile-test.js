import sinon from 'sinon';

import { rowDescriptorKey } from '../../helpers/tag-inventory-group';
import {
  applyDerivedTagInventoryRows,
  loadSyncRowID,
  reconcileTagInventoryRowsFromAnnotations,
} from '../tag-inventory-reconcile';

describe('reconcileTagInventoryRowsFromAnnotations', () => {
  let fakeStore;

  beforeEach(() => {
    fakeStore = {
      addTagInventoryRow: sinon.stub(),
      tagInventoryRows: sinon.stub().returns([]),
      mergeTagInventoryRowsWithSameTagQuery: sinon.stub(),
      savedAnnotations: sinon.stub(),
      focusedGroupId: sinon.stub().returns('group-a'),
      searchUris: sinon.stub().returns(['http://example.com']),
      mainFrame: sinon.stub().returns({ uri: 'http://example.com' }),
      setTagInventoryPublicDocumentScope: sinon.stub(),
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

    reconcileTagInventoryRowsFromAnnotations(fakeStore);

    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: loadSyncRowID('methods', ''),
      groupId: 'group-a',
      schemaTag: 'methods',
      query: '',
      annotationIds: [],
    });
    assert.calledWith(fakeStore.addTagInventoryRow, {
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

    reconcileTagInventoryRowsFromAnnotations(fakeStore);

    assert.calledWith(fakeStore.addTagInventoryRow, {
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
    fakeStore.tagInventoryRows.returns([
      {
        id: 'existing-row',
        groupId: 'group-a',
        schemaTag: 'methods',
        query: '',
        annotationIds: [],
      },
    ]);

    reconcileTagInventoryRowsFromAnnotations(fakeStore);

    assert.notCalled(fakeStore.addTagInventoryRow);
    assert.calledWith(
      fakeStore.mergeTagInventoryRowsWithSameTagQuery,
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

    reconcileTagInventoryRowsFromAnnotations(fakeStore);

    assert.notCalled(fakeStore.addTagInventoryRow);
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

    reconcileTagInventoryRowsFromAnnotations(fakeStore);

    assert.calledOnce(fakeStore.addTagInventoryRow);
    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: loadSyncRowID('results', ''),
      groupId: 'group-a',
      schemaTag: 'results',
      query: '',
      annotationIds: [],
    });
  });
});

describe('applyDerivedTagInventoryRows', () => {
  it('updates Public document scope keys', () => {
    const fakeStore = {
      addTagInventoryRow: sinon.stub(),
      tagInventoryRows: sinon.stub().returns([]),
      mergeTagInventoryRowsWithSameTagQuery: sinon.stub(),
      setTagInventoryPublicDocumentScope: sinon.stub(),
    };

    applyDerivedTagInventoryRows(fakeStore, {
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

    assert.calledWith(fakeStore.setTagInventoryPublicDocumentScope, {
      documentUri: 'http://example.com',
      visibleDescriptorKeys: [rowDescriptorKey('methods', 'q1')],
    });
  });
});
