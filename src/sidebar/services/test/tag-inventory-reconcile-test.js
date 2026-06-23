import sinon from 'sinon';

import { PUBLIC_GROUP_ID } from '../../helpers/groups';
import {
  applyDerivedTagInventoryRows,
  backfillPublicTagInventoryDocumentUris,
} from '../tag-inventory-reconcile';
import { tagInventoryRowId } from '../../store/modules/sidebar-panels';

describe('applyDerivedTagInventoryRows', () => {
  it('adds rows for schema tags found in annotations', () => {
    const fakeStore = { addTagInventoryRow: sinon.stub() };

    applyDerivedTagInventoryRows(fakeStore, {
      groupId: 'group-a',
      annotations: [
        { id: 'a1', group: 'group-a', uri: 'http://example.com', tags: ['methods'] },
        { id: 'a2', group: 'group-a', uri: 'http://example.com', tags: ['results'] },
      ],
    });

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
    const fakeStore = { addTagInventoryRow: sinon.stub() };

    applyDerivedTagInventoryRows(fakeStore, {
      groupId: 'group-a',
      annotations: [
        {
          id: 'a1',
          group: 'group-a',
          uri: 'http://example.com',
          tags: ['methods', 'ai-user-approved'],
          text: '  find methods  ',
        },
      ],
    });

    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: tagInventoryRowId('methods', 'find methods', 'group-a'),
      groupId: 'group-a',
      schemaTag: 'methods',
      query: 'find methods',
      annotationIds: [],
    });
  });

  it('generates rows for ai-pending schema tags and manual tags', () => {
    const fakeStore = { addTagInventoryRow: sinon.stub() };

    applyDerivedTagInventoryRows(fakeStore, {
      groupId: 'group-a',
      annotations: [
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
      ],
    });

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

describe('backfillPublicTagInventoryDocumentUris', () => {
  it('assigns documentUri and re-keys legacy Public rows', () => {
    const legacyId = tagInventoryRowId('methods', 'q', PUBLIC_GROUP_ID);
    const fakeStore = {
      addTagInventoryRow: sinon.stub(),
      removeTagInventoryRow: sinon.stub(),
      tagInventoryRows: sinon.stub().returns([
        {
          id: legacyId,
          groupId: PUBLIC_GROUP_ID,
          schemaTag: 'methods',
          query: 'q',
          annotationIds: ['a1'],
        },
      ]),
      mainFrame: sinon.stub().returns({ uri: 'https://example.com/paper.pdf' }),
      defaultContentFrame: sinon.stub().returns(null),
      searchUris: sinon.stub().returns(['https://example.com/paper.pdf']),
    };

    backfillPublicTagInventoryDocumentUris(fakeStore);

    const documentUri = 'https://example.com/paper.pdf';
    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: tagInventoryRowId('methods', 'q', PUBLIC_GROUP_ID, documentUri),
      groupId: PUBLIC_GROUP_ID,
      schemaTag: 'methods',
      query: 'q',
      annotationIds: ['a1'],
      documentUri,
    });
    assert.calledWith(fakeStore.removeTagInventoryRow, legacyId);
  });

  it('is a no-op when document URI is unknown', () => {
    const fakeStore = {
      addTagInventoryRow: sinon.stub(),
      removeTagInventoryRow: sinon.stub(),
      tagInventoryRows: sinon.stub().returns([
        {
          id: 'legacy',
          groupId: PUBLIC_GROUP_ID,
          schemaTag: 'methods',
          query: 'q',
          annotationIds: [],
        },
      ]),
      mainFrame: sinon.stub().returns(null),
      defaultContentFrame: sinon.stub().returns(null),
      searchUris: sinon.stub().returns([]),
    };

    backfillPublicTagInventoryDocumentUris(fakeStore);

    assert.notCalled(fakeStore.addTagInventoryRow);
    assert.notCalled(fakeStore.removeTagInventoryRow);
  });
});
