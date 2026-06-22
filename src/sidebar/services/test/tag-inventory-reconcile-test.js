import sinon from 'sinon';

import { PUBLIC_GROUP_ID } from '../../helpers/groups';
import {
  applyDerivedTagInventoryRows,
  reconcileTagInventoryRowsFromAnnotations,
} from '../tag-inventory-reconcile';
import { tagInventoryRowId } from '../../store/modules/sidebar-panels';

describe('reconcileTagInventoryRowsFromAnnotations', () => {
  let fakeStore;

  beforeEach(() => {
    fakeStore = {
      addTagInventoryRow: sinon.stub(),
      savedAnnotations: sinon.stub(),
      focusedGroupId: sinon.stub().returns('group-a'),
      searchUris: sinon.stub().returns(['http://example.com']),
      mainFrame: sinon.stub().returns({ uri: 'http://example.com' }),
    };
  });

  it('adds rows for schema tags found in annotations', () => {
    fakeStore.savedAnnotations.returns([
      { id: 'a1', group: 'group-a', uri: 'http://example.com', tags: ['methods'] },
      { id: 'a2', group: 'group-a', uri: 'http://example.com', tags: ['results'] },
    ]);

    reconcileTagInventoryRowsFromAnnotations(fakeStore);

    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: tagInventoryRowId('methods', '', 'group-a'),
      groupId: 'group-a',
      schemaTag: 'methods',
      query: '',
      annotationIds: [],
    });
    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: tagInventoryRowId('results', '', 'group-a'),
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
      id: tagInventoryRowId('methods', 'find methods', 'group-a'),
      groupId: 'group-a',
      schemaTag: 'methods',
      query: 'find methods',
      annotationIds: [],
    });
  });

  it('ignores annotations from other groups or URIs', () => {
    fakeStore.savedAnnotations.returns([
      { id: 'a1', group: 'other-group', uri: 'http://example.com', tags: ['methods'] },
      { id: 'a2', group: 'group-a', uri: 'http://other.com', tags: ['results'] },
    ]);

    reconcileTagInventoryRowsFromAnnotations(fakeStore);

    assert.notCalled(fakeStore.addTagInventoryRow);
  });

  it('generates rows for ai-pending schema tags and manual tags', () => {
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

    // 'methods' from ai-pending and 'results' from manual tag each get a row
    assert.calledTwice(fakeStore.addTagInventoryRow);
    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: tagInventoryRowId('methods', '', 'group-a'),
      groupId: 'group-a',
      schemaTag: 'methods',
      query: '',
      annotationIds: [],
    });
    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: tagInventoryRowId('results', '', 'group-a'),
      groupId: 'group-a',
      schemaTag: 'results',
      query: '',
      annotationIds: [],
    });
  });
});

describe('applyDerivedTagInventoryRows', () => {
  it('stores documentUri on Public group rows and includes it in the row id', () => {
    const fakeStore = { addTagInventoryRow: sinon.stub() };

    applyDerivedTagInventoryRows(fakeStore, {
      groupId: PUBLIC_GROUP_ID,
      documentUri: 'http://example.com',
      annotations: [
        {
          id: 'a1',
          group: PUBLIC_GROUP_ID,
          uri: 'http://example.com',
          tags: ['methods', 'ai-user-approved'],
          text: 'q1',
        },
      ],
    });

    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: tagInventoryRowId('methods', 'q1', PUBLIC_GROUP_ID, 'http://example.com'),
      groupId: PUBLIC_GROUP_ID,
      schemaTag: 'methods',
      query: 'q1',
      annotationIds: [],
      documentUri: 'http://example.com',
    });
  });

  it('does not set documentUri on private group rows', () => {
    const fakeStore = { addTagInventoryRow: sinon.stub() };

    applyDerivedTagInventoryRows(fakeStore, {
      groupId: 'group-a',
      documentUri: 'http://example.com',
      annotations: [
        {
          id: 'a1',
          group: 'group-a',
          uri: 'http://example.com',
          tags: ['methods', 'ai-user-approved'],
          text: 'q1',
        },
      ],
    });

    const call = fakeStore.addTagInventoryRow.firstCall.args[0];
    assert.equal(call.id, tagInventoryRowId('methods', 'q1', 'group-a'));
    assert.isUndefined(call.documentUri);
  });
});
