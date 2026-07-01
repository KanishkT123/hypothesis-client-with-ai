import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDescriptiveTagNodes,
  buildImplicitTagEdges,
  buildTagOnlyLayout,
  contentTags,
  documentOptionsForAnnotations,
  graphLayersForView,
  tagOnlyGraphSize,
  visibleManualTagEdges,
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

  it('exposes graph layers for quote and suggested tag-edge toggles', () => {
    for (const showQuotes of [false, true]) {
      for (const showImplicitConnections of [false, true]) {
        assert.deepEqual(
          graphLayersForView({
            showQuotes,
            showImplicitConnections,
          }),
          {
            showQuoteNodes: showQuotes,
            showAutoEdges: showQuotes,
            showEvidenceEdges: true,
            showHumanEdges: true,
            showImplicitEdges: showImplicitConnections,
          },
        );
      }
    }
  });

  it('applies edge filters to graph layers', () => {
    assert.deepEqual(
      graphLayersForView({
        showQuotes: true,
        showImplicitConnections: true,
        edgeFilters: {
          evidence: false,
          human: false,
          implicit: false,
        },
      }),
      {
        showQuoteNodes: true,
        showAutoEdges: false,
        showEvidenceEdges: false,
        showHumanEdges: false,
        showImplicitEdges: false,
      },
    );
  });

  it('adds descriptive tags as zero-evidence tag nodes', () => {
    const nodes = buildDescriptiveTagNodes({
      descriptiveTags: [
        {
          id: 'desc:1',
          tag: 'theory bridge',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      existingTags: new Set(['Character']),
    });

    assert.deepEqual(nodes, [
      {
        id: 'tag:theory bridge',
        type: 'tag',
        tag: 'theory bridge',
        count: 0,
        documentUris: new Set(),
        descriptive: true,
        descriptiveTagId: 'desc:1',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: undefined,
      },
    ]);
  });

  it('keeps descriptive tags unique against annotation tags and each other', () => {
    const nodes = buildDescriptiveTagNodes({
      descriptiveTags: [
        { id: 'desc:existing', tag: 'Character' },
        { id: 'desc:empty', tag: '   ' },
        { id: 'desc:first', tag: 'theory bridge' },
        { id: 'desc:duplicate', tag: 'theory bridge' },
      ],
      existingTags: new Set(['Character']),
    });

    assert.deepEqual(
      nodes.map(node => [node.descriptiveTagId, node.tag]),
      [['desc:first', 'theory bridge']],
    );
  });

  it('renders only manual tag edges whose endpoints are visible', () => {
    const edges = visibleManualTagEdges({
      visibleTags: new Set(['Character', 'theory bridge']),
      tagEdges: [
        {
          id: 'edge:visible',
          sourceTag: 'theory bridge',
          targetTag: 'Character',
          connectionType: 'frames',
        },
        {
          id: 'edge:orphan',
          sourceTag: 'theory bridge',
          targetTag: 'missing tag',
          connectionType: 'hides',
        },
      ],
    });

    assert.deepEqual(edges, [
      {
        id: 'edge:visible',
        sourceTag: 'theory bridge',
        targetTag: 'Character',
        connectionType: 'frames',
        type: 'human',
        source: 'tag:theory bridge',
        target: 'tag:Character',
      },
    ]);
  });

  it('computes a larger tag-only graph layout with bounded positions', () => {
    const tagNodes = Array.from({ length: 8 }, (_, index) => ({
      id: `tag:t${index}`,
      tag: `t${index}`,
    }));
    const edges = [
      { type: 'implicit', sourceTag: 't0', targetTag: 't1' },
      { type: 'implicit', sourceTag: 't0', targetTag: 't2' },
      { type: 'human', sourceTag: 't3', targetTag: 't4' },
      { type: 'implicit', sourceTag: 't5', targetTag: 't6' },
    ];

    const layout = buildTagOnlyLayout({ tagNodes, edges });
    const expectedSize = tagOnlyGraphSize(tagNodes.length);
    const positions = Object.values(layout.positions);

    assert.deepEqual(
      { width: layout.width, height: layout.height },
      expectedSize,
    );
    assert.equal(positions.length, tagNodes.length);
    assert.ok(Math.max(...positions.map(pos => pos.x)) > layout.width * 0.55);
    assert.ok(Math.min(...positions.map(pos => pos.x)) < layout.width * 0.45);
    assert.ok(Math.max(...positions.map(pos => pos.y)) > layout.height * 0.55);
    assert.ok(Math.min(...positions.map(pos => pos.y)) < layout.height * 0.45);
  });

  it('keeps saved tag-only positions pinned during layout', () => {
    const layout = buildTagOnlyLayout({
      tagNodes: [
        { id: 'tag:alpha', tag: 'alpha' },
        { id: 'tag:beta', tag: 'beta' },
      ],
      edges: [{ type: 'implicit', sourceTag: 'alpha', targetTag: 'beta' }],
      savedPositions: {
        'tag:alpha': { x: 222, y: 333 },
      },
    });

    assert.deepEqual(layout.positions['tag:alpha'], { x: 222, y: 333 });
    assert.notDeepEqual(layout.positions['tag:beta'], { x: 222, y: 333 });
  });

  it('centers a focused tag and pulls direct neighbors inward', () => {
    const tagNodes = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map(
      tag => ({
        id: `tag:${tag}`,
        tag,
      }),
    );
    const layout = buildTagOnlyLayout({
      tagNodes,
      focusedTag: 'alpha',
      edges: [
        { type: 'implicit', sourceTag: 'alpha', targetTag: 'beta' },
        { type: 'implicit', sourceTag: 'alpha', targetTag: 'gamma' },
        { type: 'implicit', sourceTag: 'delta', targetTag: 'epsilon' },
      ],
    });
    const center = {
      x: Math.round(layout.width / 2),
      y: Math.round(layout.height / 2),
    };
    const distanceFromFocus = tag => {
      const position = layout.positions[`tag:${tag}`];
      return Math.hypot(position.x - center.x, position.y - center.y);
    };

    assert.deepEqual(layout.positions['tag:alpha'], center);
    assert.ok(distanceFromFocus('beta') < distanceFromFocus('delta'));
    assert.ok(distanceFromFocus('gamma') < distanceFromFocus('epsilon'));
  });
});
