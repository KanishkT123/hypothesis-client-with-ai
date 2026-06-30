import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildImplicitTagEdges,
  contentTags,
  documentOptionsForAnnotations,
  graphLayersForView,
} from '../public/graph-model.js';

function annotation(props = {}) {
  return {
    id: props.id || 'ann',
    uri: props.uri || 'http://127.0.0.1:8765/doyle.html',
    documentTitle: props.documentTitle || 'Doyle',
    tags: props.tags || [],
    quote: props.quote === undefined ? 'A quoted sentence.' : props.quote,
    hidden: Boolean(props.hidden),
    isReply: Boolean(props.isReply),
  };
}

describe('node-link workbench graph model', () => {
  it('normalizes content tags and removes AI system tags', () => {
    assert.deepEqual(
      contentTags([
        ' hci:figure-ground ',
        'ai-pending',
        'hci:figure-ground',
        '',
        'ai-user-approved',
        'character',
      ]),
      ['hci:figure-ground', 'character'],
    );
  });

  it('counts documents separately from quote counts', () => {
    const options = documentOptionsForAnnotations([
      annotation({ id: 'a1', documentTitle: 'Doyle' }),
      annotation({ id: 'a2', documentTitle: 'Doyle' }),
      annotation({
        id: 'a3',
        uri: 'http://127.0.0.1:8765/little-women-1.html',
        documentTitle: 'Little Women',
      }),
      annotation({ id: 'reply', isReply: true }),
      annotation({ id: 'hidden', hidden: true }),
      annotation({ id: 'no-quote', quote: '' }),
    ]);

    assert.equal(options.length, 2);
    assert.deepEqual(
      options.map(option => [option.label, option.count]),
      [
        ['Doyle', 2],
        ['Little Women', 1],
      ],
    );
  });

  it('builds extensible implicit tag connections from same-document evidence', () => {
    const implicitEdges = buildImplicitTagEdges({
      tagNodes: [
        {
          tag: 'character',
          documentUris: ['doyle', 'little-women'],
        },
        {
          tag: 'constraint',
          documentUris: ['doyle'],
        },
        {
          tag: 'social-proof',
          documentUris: ['little-women'],
        },
      ],
      documentOptions: [
        { uri: 'doyle', label: 'Doyle', count: 2 },
        { uri: 'little-women', label: 'Little Women', count: 1 },
      ],
    });

    assert.deepEqual(
      implicitEdges.map(edge => ({
        sourceTag: edge.sourceTag,
        targetTag: edge.targetTag,
        generator: edge.generator.id,
        evidence: edge.evidence.map(item => item.label),
      })),
      [
        {
          sourceTag: 'character',
          targetTag: 'constraint',
          generator: 'co-document/v1',
          evidence: ['Doyle'],
        },
        {
          sourceTag: 'character',
          targetTag: 'social-proof',
          generator: 'co-document/v1',
          evidence: ['Little Women'],
        },
      ],
    );
  });

  it('hides implicit edges that have already been promoted to real edges', () => {
    const implicitEdges = buildImplicitTagEdges({
      tagNodes: [
        { tag: 'character', documentUris: ['doyle'] },
        { tag: 'constraint', documentUris: ['doyle'] },
      ],
      tagEdges: [{ sourceTag: 'constraint', targetTag: 'character' }],
      documentOptions: [{ uri: 'doyle', label: 'Doyle', count: 2 }],
    });

    assert.deepEqual(implicitEdges, []);
  });

  it('exposes graph layers for quote, implicit, and selection-first toggles', () => {
    for (const showQuotes of [false, true]) {
      for (const showImplicitConnections of [false, true]) {
        for (const selectionFirstEdges of [false, true]) {
          assert.deepEqual(
            graphLayersForView({
              showQuotes,
              showImplicitConnections,
              selectionFirstEdges,
            }),
            {
              showQuoteNodes: showQuotes,
              showAutoEdges: showQuotes,
              showImplicitEdges: showImplicitConnections,
              selectionFirstEdges,
            },
          );
        }
      }
    }
  });
});
