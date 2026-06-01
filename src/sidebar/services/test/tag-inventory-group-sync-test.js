import sinon from 'sinon';

import { PUBLIC_GROUP_ID } from '../../helpers/groups';
import { rowDescriptorKey } from '../../helpers/tag-inventory-group';
import {
  TagInventoryGroupSyncService,
  savedAnnotationsForCurrentDocument,
} from '../tag-inventory-group-sync';
import { loadSyncRowID } from '../tag-inventory-reconcile';

describe('TagInventoryGroupSyncService', () => {
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
      addTagInventoryRow: sinon.stub(),
      tagInventoryRows: sinon.stub().returns([]),
      focusedGroupId: sinon.stub().returns('private-group'),
      hasFetchedProfile: sinon.stub().returns(true),
      mainFrame: sinon.stub().returns({ uri: 'http://example.com' }),
      mergeTagInventoryRowsWithSameTagQuery: sinon.stub(),
      pruneTagInventoryRowsForGroup: sinon.stub(),
      savedAnnotations: sinon.stub().returns([]),
      searchUris: sinon.stub().returns(['http://example.com']),
      setTagInventoryPublicDocumentScope: sinon.stub(),
      subscribe: sinon.stub().returns(sinon.stub()),
    };

    svc = new TagInventoryGroupSyncService(fakeApi, fakeStore);
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

    await svc.syncGroupInventory({ mode: 'document' });

    assert.notCalled(groupAnnotationsRead);
    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: loadSyncRowID('methods', ''),
      groupId: PUBLIC_GROUP_ID,
      schemaTag: 'methods',
      query: '',
      annotationIds: [],
    });
    assert.calledWith(fakeStore.setTagInventoryPublicDocumentScope, {
      documentUri: 'http://example.com',
      visibleDescriptorKeys: [rowDescriptorKey('methods', '')],
    });
  });

  it('fetches all group annotations for private groups via the group annotations endpoint', async () => {
    await svc.syncGroupInventory({ mode: 'auto' });

    assert.calledOnce(groupAnnotationsRead);
    assert.calledWith(
      groupAnnotationsRead,
      sinon.match({ id: 'private-group', 'page[size]': 100 }),
    );

    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: loadSyncRowID('methods', 'find it'),
      groupId: 'private-group',
      schemaTag: 'methods',
      query: 'find it',
      annotationIds: [],
    });
    assert.calledOnce(fakeStore.pruneTagInventoryRowsForGroup);
  });

  it('returns null from cachedGroupAnnotations before a full fetch', () => {
    assert.isNull(svc.cachedGroupAnnotations('private-group'));
  });

  it('caches annotations after a private full-group sync', async () => {
    await svc.syncGroupInventory({ mode: 'auto' });

    const cached = svc.cachedGroupAnnotations('private-group');
    assert.lengthOf(cached, 1);
    assert.equal(cached[0].id, 'a1');
  });

  it('does not populate cache for document-scoped private sync', async () => {
    fakeStore.savedAnnotations.returns([
      {
        id: 'doc-a1',
        group: 'private-group',
        uri: 'http://example.com',
        tags: ['methods'],
      },
    ]);

    await svc.syncGroupInventory({ mode: 'document' });

    assert.isNull(svc.cachedGroupAnnotations('private-group'));
  });

  it('savedAnnotationsForCurrentDocument filters by group and URIs', () => {
    const result = savedAnnotationsForCurrentDocument(
      [
        { id: '1', group: PUBLIC_GROUP_ID, uri: 'http://a.com', tags: [] },
        { id: '2', group: PUBLIC_GROUP_ID, uri: 'http://b.com', tags: [] },
        { id: '3', group: 'other', uri: 'http://a.com', tags: [] },
      ],
      PUBLIC_GROUP_ID,
      ['http://a.com'],
    );
    assert.lengthOf(result, 1);
    assert.equal(result[0].id, '1');
  });

  it('mergePendingUpdatesIntoCache upserts updates and removes deletions', async () => {
    await svc.syncGroupInventory({ mode: 'auto' });

    svc.mergePendingUpdatesIntoCache(
      [
        {
          id: 'a2',
          group: 'private-group',
          uri: 'http://new.com',
          tags: ['results'],
          created: '2024-02-01T00:00:00Z',
        },
      ],
      ['a1'],
    );

    const cached = svc.cachedGroupAnnotations('private-group');
    assert.lengthOf(cached, 1);
    assert.equal(cached[0].id, 'a2');
  });

  it('mergePendingUpdatesIntoCache is a no-op before cache is loaded', () => {
    svc.mergePendingUpdatesIntoCache(
      [{ id: 'x', group: 'private-group', uri: 'http://x.com', tags: [] }],
      [],
    );
    assert.isNull(svc.cachedGroupAnnotations('private-group'));
  });

  it('init watch ignores unrelated store updates (uses shallowEqual)', async () => {
    let subscribeCallback;
    fakeStore.subscribe = cb => {
      subscribeCallback = cb;
      return () => {};
    };
    fakeStore.hasFetchedProfile.returns(true);
    fakeStore.focusedGroupId.returns('private-group');

    svc.init();

    subscribeCallback();
    await Promise.resolve();
    await svc.waitForSyncIfInFlight();

    assert.calledOnce(groupAnnotationsRead);
    groupAnnotationsRead.resetHistory();

    // Simulate an unrelated store update (e.g. apiRequestStarted) while the
    // focused group and profile state are unchanged.
    subscribeCallback();
    await Promise.resolve();

    assert.notCalled(groupAnnotationsRead);
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

    await svc.syncGroupInventory({ mode: 'auto' });

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
