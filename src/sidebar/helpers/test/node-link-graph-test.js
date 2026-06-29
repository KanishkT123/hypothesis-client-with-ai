import * as fixtures from '../../test/annotation-fixtures';
import {
  buildNodeLinkGraph,
  nodeLinkTagsForAnnotation,
} from '../node-link-graph';

function savedAnn(props = {}) {
  const {
    id,
    uri = 'http://example.com/doc',
    tags = [],
    quote = 'quote',
  } = props;
  return {
    ...fixtures.defaultAnnotation(),
    id,
    uri,
    tags,
    target: [
      {
        source: uri,
        selector: [{ type: 'TextQuoteSelector', exact: quote }],
      },
    ],
    ...props,
  };
}

describe('sidebar/helpers/node-link-graph', () => {
  describe('nodeLinkTagsForAnnotation', () => {
    it('normalizes tags and excludes AI system tags', () => {
      assert.deepEqual(
        nodeLinkTagsForAnnotation(
          savedAnn({
            tags: [
              ' methods ',
              'ai-pending',
              'methods',
              'ai-user-approved',
              'results',
              '',
            ],
          }),
        ),
        ['methods', 'results'],
      );
    });
  });

  describe('buildNodeLinkGraph', () => {
    it('builds tag and quote nodes for tagged passages in scope', () => {
      const graph = buildNodeLinkGraph(
        [
          savedAnn({
            id: 'a1',
            tags: ['methods', 'ai-pending'],
            quote: 'Alpha passage',
          }),
          savedAnn({
            id: 'a2',
            tags: ['results', 'methods'],
            quote: 'Beta passage',
          }),
          savedAnn({
            id: 'reply',
            references: ['a1'],
            tags: ['methods'],
            quote: 'Reply passage',
          }),
          savedAnn({
            id: 'hidden',
            hidden: true,
            tags: ['methods'],
            quote: 'Hidden passage',
          }),
          savedAnn({
            id: 'other-doc',
            uri: 'http://example.com/other',
            tags: ['methods'],
            quote: 'Other passage',
          }),
          savedAnn({ id: 'untagged', tags: [], quote: 'Untagged passage' }),
        ],
        { uris: ['http://example.com/doc'] },
      );

      assert.deepEqual(
        graph.tagNodes.map(node => ({
          tag: node.tag,
          annotationIds: node.annotationIds,
        })),
        [
          { tag: 'methods', annotationIds: ['a1', 'a2'] },
          { tag: 'results', annotationIds: ['a2'] },
        ],
      );
      assert.deepEqual(
        graph.quoteNodes.map(node => ({
          annotationId: node.annotationId,
          quote: node.quote,
          tags: node.tags,
        })),
        [
          {
            annotationId: 'a1',
            quote: 'Alpha passage',
            tags: ['methods'],
          },
          {
            annotationId: 'a2',
            quote: 'Beta passage',
            tags: ['methods', 'results'],
          },
        ],
      );
      assert.deepEqual(
        graph.edges.map(edge => ({
          source: edge.source,
          target: edge.target,
          annotationId: edge.annotationId,
          tag: edge.tag,
        })),
        [
          {
            source: 'tag:methods',
            target: 'quote:a1',
            annotationId: 'a1',
            tag: 'methods',
          },
          {
            source: 'tag:methods',
            target: 'quote:a2',
            annotationId: 'a2',
            tag: 'methods',
          },
          {
            source: 'tag:results',
            target: 'quote:a2',
            annotationId: 'a2',
            tag: 'results',
          },
        ],
      );
    });
  });
});
