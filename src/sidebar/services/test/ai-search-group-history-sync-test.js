import sinon from 'sinon';

import { PUBLIC_GROUP_ID } from '../../helpers/groups';
import { rowDescriptorKey } from '../../helpers/ai-search-group-history';
import { AISearchGroupHistorySyncService } from '../ai-search-group-history-sync';
import { loadSyncRowID } from '../ai-search-history-reconcile';

describe('AISearchGroupHistorySyncService', () => {
  let fakeApi;
  let fakeStore;
  let svc;
  let groupAnnotationsRead;

  beforeEach(() => {
    groupAnnotationsRead = sinon.stub().resolves({
      meta: { page: { total: 1 } },
      data: [
        {
          id: 'a1',
          group: 'private-group',
          uri: 'http://other.com',
          tags: ['methods', 'ai-user-approved'],
          text: 'find it',
          created: '2024-01-01T00:00:00Z',
        },
      ],
    });

    fakeApi = {
      group: {
        annotations: {
          read: groupAnnotationsRead,
        },
      },
    };

    fakeStore = {
      addAISearchRow: sinon.stub(),
      aiSearchRows: sinon.stub().returns([]),
      focusedGroupId: sinon.stub().returns('private-group'),
      hasFetchedProfile: sinon.stub().returns(true),
      mainFrame: sinon.stub().returns({ uri: 'http://example.com' }),
      mergeAISearchRowsWithSameTagQuery: sinon.stub(),
      pruneAISearchRowsForGroup: sinon.stub(),
      savedAnnotations: sinon.stub().returns([]),
      searchUris: sinon.stub().returns(['http://example.com']),
      setAISearchPublicDocumentScope: sinon.stub(),
      subscribe: sinon.stub().returns(sinon.stub()),
    };

    svc = new AISearchGroupHistorySyncService(fakeApi, fakeStore);
  });

  it('uses savedAnnotations only for Public group document sync', async () => {
    fakeStore.focusedGroupId.returns(PUBLIC_GROUP_ID);
    fakeStore.savedAnnotations.returns([
      {
        id: 'a1',
        group: PUBLIC_GROUP_ID,
        uri: 'http://example.com',
        tags: ['methods'],
      },
      {
        id: 'a2',
        group: 'other',
        uri: 'http://example.com',
        tags: ['ignored'],
      },
    ]);

    await svc.syncGroupHistory({ mode: 'document' });

    assert.notCalled(groupAnnotationsRead);
    assert.calledWith(fakeStore.addAISearchRow, {
      id: loadSyncRowID('methods', ''),
      groupId: PUBLIC_GROUP_ID,
      schemaTag: 'methods',
      query: '',
      annotationIds: [],
    });
    assert.calledWith(fakeStore.setAISearchPublicDocumentScope, {
      documentUri: 'http://example.com',
      visibleDescriptorKeys: [rowDescriptorKey('methods', '')],
    });
  });

  it('fetches all group annotations for private groups via the group annotations endpoint', async () => {
    await svc.syncGroupHistory({ mode: 'auto' });

    assert.calledOnce(groupAnnotationsRead);
    assert.calledWith(
      groupAnnotationsRead,
      sinon.match({ id: 'private-group', 'page[size]': 100 }),
    );

    assert.calledWith(fakeStore.addAISearchRow, {
      id: loadSyncRowID('methods', 'find it'),
      groupId: 'private-group',
      schemaTag: 'methods',
      query: 'find it',
      annotationIds: [],
    });
    assert.calledOnce(fakeStore.pruneAISearchRowsForGroup);
  });

  it('paginates with page[after] until a short page is returned', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      id: `a${i}`,
      group: 'private-group',
      uri: 'http://other.com',
      tags: ['methods'],
      created: `2024-01-01T00:00:${String(i).padStart(2, '0')}Z`,
    }));
    groupAnnotationsRead.onFirstCall().resolves({
      meta: { page: { total: 101 } },
      data: fullPage,
    });
    groupAnnotationsRead.onSecondCall().resolves({
      meta: { page: { total: 101 } },
      data: [
        {
          id: 'last',
          group: 'private-group',
          uri: 'http://other.com',
          tags: ['results'],
          created: '2024-01-02T00:00:00Z',
        },
      ],
    });

    await svc.syncGroupHistory({ mode: 'auto' });

    assert.calledTwice(groupAnnotationsRead);
    assert.calledWith(
      groupAnnotationsRead.secondCall,
      sinon.match({
        id: 'private-group',
        'page[size]': 100,
        'page[after]': fullPage[99].created,
      }),
    );
  });
});
