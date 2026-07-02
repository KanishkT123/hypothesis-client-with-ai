import * as fixtures from '../../test/annotation-fixtures';
import { buildNodeLinkGraph, documentLabelFromUrl } from '../graph-model';
import { emptyNodeLinkState, NODE_LINK_STATE_TAG } from '../graph-state';

function annotation(overrides = {}) {
  return {
    ...fixtures.defaultAnnotation(),
    id: 'ann-1',
    group: 'group-a',
    uri: 'http://example.com/doc-one.html',
    document: { title: 'Document One' },
    tags: ['Character'],
    target: [
      {
        source: 'http://example.com/doc-one.html',
        selector: [{ type: 'TextQuoteSelector', exact: 'A quoted sentence.' }],
      },
    ],
    links: { incontext: 'http://example.com/doc-one.html#annotations:ann-1' },
    references: [],
    hidden: false,
    ...overrides,
  };
}

describe('node-link graph model', () => {
  it('uses readable document labels from URLs', () => {
    assert.equal(
      documentLabelFromUrl('http://example.com/little-women-1.html'),
      'little women 1.html',
    );
  });

  it('builds tags, documents and quote evidence from annotations', () => {
    const graph = buildNodeLinkGraph(
      [
        annotation(),
        annotation({
          id: 'ann-2',
          uri: 'http://example.com/doc-two.html',
          document: { title: 'Document Two' },
          tags: ['Character', 'Action'],
          target: [
            {
              source: 'http://example.com/doc-two.html',
              selector: [
                {
                  type: 'TextQuoteSelector',
                  exact: 'Another quoted sentence.',
                },
              ],
            },
          ],
        }),
      ],
      emptyNodeLinkState(),
    );

    assert.deepEqual(
      graph.tags.map(tag => [tag.tag, tag.quoteCount, tag.documentCount]),
      [
        ['Character', 2, 2],
        ['Action', 1, 1],
      ],
    );
    assert.lengthOf(graph.documents, 2);
    assert.lengthOf(graph.quotes, 2);
  });

  it('filters internal node-link state annotations out of evidence', () => {
    const graph = buildNodeLinkGraph(
      [
        annotation(),
        annotation({
          id: 'state-ann',
          tags: [NODE_LINK_STATE_TAG],
          text: '{"kind":"hypothesis-node-link-state"}',
        }),
      ],
      emptyNodeLinkState(),
    );

    assert.deepEqual(
      graph.tags.map(tag => tag.tag),
      ['Character'],
    );
  });

  it('adds descriptive tags and only visible manual edges', () => {
    const graph = buildNodeLinkGraph(
      [annotation()],
      emptyNodeLinkState({
        descriptiveTags: [{ id: 'desc-theme', tag: 'Theme' }],
        tagEdges: [
          {
            sourceTag: 'Character',
            targetTag: 'Theme',
            connectionType: 'explains',
          },
          {
            sourceTag: 'Character',
            targetTag: 'Missing',
            connectionType: 'points to hidden',
          },
        ],
      }),
    );

    assert.deepEqual(
      graph.tags.map(tag => [tag.tag, tag.descriptive]),
      [
        ['Character', false],
        ['Theme', true],
      ],
    );
    assert.deepEqual(
      graph.manualEdges.map(edge => [
        edge.sourceTag,
        edge.connectionType,
        edge.targetTag,
      ]),
      [['Character', 'explains', 'Theme']],
    );
  });
});
