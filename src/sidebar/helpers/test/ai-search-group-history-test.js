import * as fixtures from '../../test/annotation-fixtures';

import {
  deriveAISearchHistoryRowDescriptors,
  isAISearchRowVisibleInScope,
  isNegativeSchemaTag,
  negativeSchemaTagForPositiveTag,
  negativeSchemaTags,
  positiveSchemaTags,
  pruneAISearchRowsToDescriptors,
  rowDescriptorKey,
  sortAISearchRows,
} from '../ai-search-group-history';
import { PUBLIC_GROUP_ID } from '../groups';

function publicScope(documentUri, keys) {
  return {
    focusedGroupId: PUBLIC_GROUP_ID,
    publicDocumentDescriptorKeys: new Set(keys),
  };
}

function privateScope(groupId) {
  return { focusedGroupId: groupId };
}

describe('sidebar/helpers/ai-search-group-history', () => {
  const pdf = 'http://example.com/paper.pdf';
  const pdfB = 'http://example.com/other.pdf';
  const groupA = 'group-a-id';

  function savedAnn(props) {
    const {
      id,
      uri = pdf,
      tags = [],
      text = '',
      references = [],
    } = props;
    return {
      ...fixtures.defaultAnnotation(),
      id,
      uri,
      tags,
      text,
      references,
    };
  }

  describe('schema tag classification', () => {
    it('isNegativeSchemaTag matches suffix tags with non-empty prefix', () => {
      assert.isTrue(isNegativeSchemaTag('methods-neg-example'));
      assert.isFalse(isNegativeSchemaTag('methods'));
      assert.isFalse(isNegativeSchemaTag('-neg-example'));
    });

    it('negativeSchemaTagForPositiveTag appends suffix', () => {
      assert.equal(
        negativeSchemaTagForPositiveTag('methods'),
        'methods-neg-example',
      );
    });

    it('positiveSchemaTags excludes system and negative schema tags', () => {
      assert.deepEqual(
        positiveSchemaTags([
          'methods',
          'methods-neg-example',
          'ai-pending',
          'ai-user-approved',
        ]),
        ['methods'],
      );
    });

    it('negativeSchemaTags returns only negative schema tags', () => {
      assert.deepEqual(
        negativeSchemaTags(['methods', 'methods-neg-example']),
        ['methods-neg-example'],
      );
    });
  });

  describe('deriveAISearchHistoryRowDescriptors', () => {
    it('ai-user-approved on methods yields row with query from text', () => {
      const descriptors = deriveAISearchHistoryRowDescriptors([
        savedAnn({
          id: 'a1',
          tags: ['methods', 'ai-user-approved'],
          text: '  stats query  ',
        }),
      ]);
      assert.deepEqual(descriptors, [
        { schemaTag: 'methods', query: 'stats query' },
      ]);
    });

    it('neg-example tag yields neg row, not positive methods', () => {
      const descriptors = deriveAISearchHistoryRowDescriptors([
        savedAnn({
          id: 'n1',
          tags: ['methods-neg-example'],
          text: 'declined q',
        }),
      ]);
      assert.deepEqual(descriptors, [
        { schemaTag: 'methods-neg-example', query: 'declined q' },
      ]);
    });

    it('manual tag only yields empty query row', () => {
      const descriptors = deriveAISearchHistoryRowDescriptors([
        savedAnn({
          id: 'm1',
          tags: ['methods'],
          text: 'ignored for manual',
        }),
      ]);
      assert.deepEqual(descriptors, [{ schemaTag: 'methods', query: '' }]);
    });

    it('ignores replies and system-tag-only annotations', () => {
      const descriptors = deriveAISearchHistoryRowDescriptors([
        savedAnn({
          id: 'r1',
          tags: ['methods'],
          references: ['parent'],
        }),
        savedAnn({
          id: 's1',
          tags: ['ai-user-approved'],
          text: 'q',
        }),
      ]);
      assert.lengthOf(descriptors, 0);
    });

    it('dedupes same tag+query across different document URIs', () => {
      const descriptors = deriveAISearchHistoryRowDescriptors([
        savedAnn({
          id: 'a1',
          uri: pdf,
          tags: ['methods', 'ai-user-approved'],
          text: 'regression',
        }),
        savedAnn({
          id: 'a2',
          uri: pdfB,
          tags: ['methods', 'ai-user-approved'],
          text: 'regression',
        }),
      ]);
      assert.deepEqual(descriptors, [
        { schemaTag: 'methods', query: 'regression' },
      ]);
    });
  });

  describe('rowDescriptorKey / prune / sort', () => {
    it('rowDescriptorKey encodes tag and query only', () => {
      assert.equal(
        rowDescriptorKey('methods', 'q'),
        rowDescriptorKey('methods', 'q'),
      );
      assert.notEqual(
        rowDescriptorKey('methods', 'q'),
        rowDescriptorKey('methods', 'other'),
      );
    });

    it('pruneAISearchRowsToDescriptors keeps other groups and drops stale rows', () => {
      const rows = [
        {
          id: '1',
          schemaTag: 'methods',
          query: 'q',
          annotationIds: [],
          groupId: groupA,
        },
        {
          id: '2',
          schemaTag: 'old',
          query: '',
          annotationIds: [],
          groupId: groupA,
        },
        {
          id: '3',
          schemaTag: 'other',
          query: '',
          annotationIds: [],
          groupId: 'other-group',
        },
      ];
      const pruned = pruneAISearchRowsToDescriptors(
        rows,
        [{ schemaTag: 'methods', query: 'q' }],
        groupA,
      );
      assert.deepEqual(
        pruned.map(r => r.id),
        ['1', '3'],
      );
    });

    it('sortAISearchRows orders by schemaTag then query', () => {
      const sorted = sortAISearchRows([
        { id: 'b', schemaTag: 'zebra', query: 'a', annotationIds: [] },
        { id: 'a', schemaTag: 'methods', query: 'z', annotationIds: [] },
        { id: 'c', schemaTag: 'methods', query: 'a', annotationIds: [] },
      ]);
      assert.deepEqual(
        sorted.map(r => r.id),
        ['c', 'a', 'b'],
      );
    });
  });

  describe('isAISearchRowVisibleInScope', () => {
    const baseRow = {
      id: 'r1',
      schemaTag: 'methods',
      query: 'q',
      annotationIds: [],
      groupId: groupA,
    };

    it('private group: visible when groupId matches', () => {
      assert.isTrue(isAISearchRowVisibleInScope(baseRow, privateScope(groupA)));
      assert.isFalse(isAISearchRowVisibleInScope(baseRow, privateScope('other')));
    });

    it('public group: visible only when descriptor key is in current-doc set', () => {
      const publicRow = { ...baseRow, groupId: PUBLIC_GROUP_ID };
      const key = rowDescriptorKey('methods', 'q');
      assert.isTrue(
        isAISearchRowVisibleInScope(publicRow, publicScope(pdf, [key])),
      );
      assert.isFalse(
        isAISearchRowVisibleInScope(
          publicRow,
          publicScope(pdf, [rowDescriptorKey('other', '')]),
        ),
      );
      assert.isFalse(
        isAISearchRowVisibleInScope(publicRow, {
          focusedGroupId: PUBLIC_GROUP_ID,
          publicDocumentDescriptorKeys: null,
        }),
      );
    });

    it('hides rows missing groupId', () => {
      assert.isFalse(
        isAISearchRowVisibleInScope(
          { ...baseRow, groupId: undefined },
          privateScope(groupA),
        ),
      );
    });
  });
});
