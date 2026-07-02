import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NODE_LINK_STATE_TAG,
  createHypothesisStatePayload,
  editsFromHypothesisStatePayload,
  isNodeLinkStateAnnotation,
  normalizeGraphEdits,
  parseHypothesisStateText,
  serializeHypothesisState,
  tagLegendText,
} from '../public/graph-state.js';

describe('node-link Hypothesis state', () => {
  it('round-trips semantic edits through a state payload without layout', () => {
    const edits = normalizeGraphEdits({
      selectedGroupId: 'group-a',
      layout: {
        version: 3,
        nodes: {
          'tag:Character': { x: 12, y: 34 },
        },
      },
      descriptiveTags: [{ id: 'desc:1', tag: 'Design theory' }],
      tagEdges: [
        {
          id: 'edge:1',
          sourceTag: 'Character',
          targetTag: 'Action',
          connectionType: 'explains',
        },
      ],
      annotations: [{ id: 'should-not-be-saved' }],
    });

    const payload = createHypothesisStatePayload(edits, {
      groupId: 'group-a',
      stateUri: 'https://example.test/state/group-a',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const parsed = parseHypothesisStateText(serializeHypothesisState(payload));
    const restored = editsFromHypothesisStatePayload(parsed);

    assert.equal(parsed.kind, 'hypothesis-node-link-state');
    assert.equal(parsed.groupId, 'group-a');
    assert.equal(parsed.edits.annotations, undefined);
    assert.equal(parsed.edits.layout, undefined);
    assert.deepEqual(restored.tagEdges, edits.tagEdges);
    assert.deepEqual(restored.descriptiveTags, edits.descriptiveTags);
    assert.deepEqual(restored.layout, { version: 2, nodes: {} });
  });

  it('recognizes node-link state annotations by reserved tag', () => {
    assert.equal(
      isNodeLinkStateAnnotation({
        tags: [NODE_LINK_STATE_TAG],
        text: '{}',
      }),
      true,
    );
    assert.equal(
      isNodeLinkStateAnnotation({
        tags: ['Character'],
        text: 'normal annotation',
      }),
      false,
    );
  });

  it('exports a human-readable legend for manual tag-tag edges only', () => {
    const legend = tagLegendText({
      tagEdges: [
        {
          sourceTag: 'Character',
          targetTag: 'Action',
          connectionType: 'explains',
        },
        {
          sourceTag: 'Character',
          targetTag: 'Flaws',
          connectionType: 'encompasses',
        },
        {
          sourceTag: 'Trust',
          targetTag: 'Character',
          connectionType: 'qualifies',
        },
      ],
    });

    assert.equal(
      legend,
      [
        'Action',
        '   --- incoming relationships ---',
        '   Character explains Action',
        'Character',
        '   explains Action',
        '   encompasses Flaws',
        '   --- incoming relationships ---',
        '   Trust qualifies Character',
        'Flaws',
        '   --- incoming relationships ---',
        '   Character encompasses Flaws',
        'Trust',
        '   qualifies Character',
        '',
      ].join('\n'),
    );
  });
});
