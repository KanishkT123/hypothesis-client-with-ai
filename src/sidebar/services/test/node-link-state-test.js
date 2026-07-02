import sinon from 'sinon';

import {
  NODE_LINK_STATE_KIND,
  NODE_LINK_STATE_SCHEMA_VERSION,
  NODE_LINK_STATE_TAG,
  NODE_LINK_STATE_VERSION_TAG,
  nodeLinkStateUri,
} from '../../node-link/graph-state';
import * as fixtures from '../../test/annotation-fixtures';
import { NodeLinkStateService } from '../node-link-state';

describe('NodeLinkStateService', () => {
  let fakeApi;
  let service;

  function statePayload(overrides = {}) {
    return {
      kind: NODE_LINK_STATE_KIND,
      schemaVersion: NODE_LINK_STATE_SCHEMA_VERSION,
      groupId: 'group-a',
      stateUri: nodeLinkStateUri('group-a'),
      updatedAt: '2026-07-01T12:00:00.000Z',
      edits: {
        descriptiveTags: [{ id: 'desc-theme', tag: 'Theme' }],
        tagEdges: [
          {
            id: 'edge-character-theme',
            sourceTag: 'Character',
            targetTag: 'Theme',
            connectionType: 'explains',
          },
        ],
      },
      ...overrides,
    };
  }

  function stateAnnotation(overrides = {}) {
    return {
      ...fixtures.defaultAnnotation(),
      id: 'state-annotation',
      group: 'group-a',
      uri: nodeLinkStateUri('group-a'),
      tags: [NODE_LINK_STATE_TAG, NODE_LINK_STATE_VERSION_TAG],
      text: JSON.stringify(statePayload()),
      updated: '2026-07-01T12:00:00.000Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    fakeApi = {
      search: sinon.stub().resolves({ rows: [] }),
    };
    service = new NodeLinkStateService(fakeApi);
  });

  it('searches the selected group state URI', async () => {
    await service.loadState('group-a');

    assert.calledWith(
      fakeApi.search,
      sinon.match({
        group: 'group-a',
        uri: nodeLinkStateUri('group-a'),
        tag: NODE_LINK_STATE_TAG,
        limit: 10,
        sort: 'updated',
        order: 'desc',
      }),
    );
  });

  it('returns missing state when the group has not saved node-link state', async () => {
    const result = await service.loadState('group-a');

    assert.equal(result.status, 'missing');
    assert.equal(result.annotationId, null);
    assert.equal(result.state.selectedGroupId, 'group-a');
    assert.deepEqual(result.state.tagEdges, []);
  });

  it('loads the newest matching state annotation', async () => {
    fakeApi.search.resolves({
      rows: [
        {
          ...fixtures.defaultAnnotation(),
          id: 'normal-annotation',
          group: 'group-a',
          tags: ['Character'],
          text: 'not node-link state',
        },
        stateAnnotation({
          id: 'old-state',
          updated: '2026-07-01T10:00:00.000Z',
          text: JSON.stringify(
            statePayload({
              edits: {
                descriptiveTags: [{ id: 'desc-old', tag: 'Old theme' }],
                tagEdges: [],
              },
            }),
          ),
        }),
        stateAnnotation({
          id: 'new-state',
          updated: '2026-07-01T13:00:00.000Z',
        }),
      ],
    });

    const result = await service.loadState('group-a');

    assert.equal(result.status, 'loaded');
    assert.equal(result.annotationId, 'new-state');
    assert.deepEqual(
      result.state.descriptiveTags.map(tag => tag.tag),
      ['Theme'],
    );
    assert.deepEqual(
      result.state.tagEdges.map(edge => [
        edge.sourceTag,
        edge.connectionType,
        edge.targetTag,
      ]),
      [['Character', 'explains', 'Theme']],
    );
  });

  it('reports invalid state annotations without throwing', async () => {
    fakeApi.search.resolves({
      rows: [stateAnnotation({ text: 'not json' })],
    });

    const result = await service.loadState('group-a');

    assert.equal(result.status, 'invalid');
    assert.equal(result.annotationId, 'state-annotation');
    assert.equal(result.state.selectedGroupId, 'group-a');
    assert.match(result.message, /Unexpected token|JSON/);
  });
});
