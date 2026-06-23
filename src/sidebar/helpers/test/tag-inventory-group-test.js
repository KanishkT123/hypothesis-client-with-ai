import * as fixtures from '../../test/annotation-fixtures';

import {
  canMarkTagAsNegativeExample,
  canRevertNegativeExampleTag,
  deriveTagInventoryRowDescriptors,
  isTagInventoryRowVisibleInScope,
  isConvertiblePositiveContentTag,
  isNegativeSchemaTag,
  negativeSchemaTagForPositiveTag,
  negativeSchemaTags,
  positiveSchemaTagForNegativeTag,
  positiveSchemaTags,
  pruneTagInventoryRowsToDescriptors,
  retagOneNegativeSchemaTagAsPositive,
  retagOnePositiveSchemaTagAsNegative,
  rowDescriptorKey,
  sortTagInventoryRows,
} from '../tag-inventory-group';
import { PUBLIC_GROUP_ID } from '../groups';

function publicScope(documentUri) {
  return {
    focusedGroupId: PUBLIC_GROUP_ID,
    currentDocumentUri: documentUri,
  };
}

function privateScope(groupId) {
  return { focusedGroupId: groupId };
}

describe('sidebar/helpers/tag-inventory-group', () => {
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

  describe('tag pill retag helpers', () => {
    it('isConvertiblePositiveContentTag excludes system and negative tags', () => {
      assert.isTrue(isConvertiblePositiveContentTag('methods'));
      assert.isFalse(isConvertiblePositiveContentTag('methods-neg-example'));
      assert.isFalse(isConvertiblePositiveContentTag('ai-pending'));
    });

    it('positiveSchemaTagForNegativeTag strips suffix', () => {
      assert.equal(
        positiveSchemaTagForNegativeTag('methods-neg-example'),
        'methods',
      );
      assert.isNull(positiveSchemaTagForNegativeTag('methods'));
    });

    it('retagOnePositiveSchemaTagAsNegative converts one positive tag', () => {
      assert.deepEqual(
        retagOnePositiveSchemaTagAsNegative(['methods'], 'methods'),
        ['methods-neg-example'],
      );
      assert.deepEqual(
        retagOnePositiveSchemaTagAsNegative(
          ['methods', 'ai-user-approved'],
          'methods',
        ),
        ['methods-neg-example'],
      );
      assert.deepEqual(
        retagOnePositiveSchemaTagAsNegative(['methods', 'other'], 'methods'),
        ['other', 'methods-neg-example'],
      );
      assert.isNull(
        retagOnePositiveSchemaTagAsNegative(['methods-neg-example'], 'methods'),
      );
    });

    it('retagOneNegativeSchemaTagAsPositive reverts one negative tag', () => {
      assert.deepEqual(
        retagOneNegativeSchemaTagAsPositive(
          ['methods-neg-example'],
          'methods-neg-example',
        ),
        ['methods'],
      );
      assert.deepEqual(
        retagOneNegativeSchemaTagAsPositive(
          ['methods-neg-example', 'other'],
          'methods-neg-example',
        ),
        ['methods', 'other'],
      );
      assert.isNull(
        retagOneNegativeSchemaTagAsPositive(['methods'], 'methods-neg-example'),
      );
    });

    it('canMarkTagAsNegativeExample requires no ai-pending', () => {
      assert.isTrue(canMarkTagAsNegativeExample(['methods'], 'methods'));
      assert.isFalse(
        canMarkTagAsNegativeExample(['ai-pending', 'methods'], 'methods'),
      );
    });

    it('canRevertNegativeExampleTag requires negative tag and no ai-pending', () => {
      assert.isTrue(
        canRevertNegativeExampleTag(
          ['methods-neg-example'],
          'methods-neg-example',
        ),
      );
      assert.isFalse(
        canRevertNegativeExampleTag(
          ['ai-pending', 'methods-neg-example'],
          'methods-neg-example',
        ),
      );
    });
  });

  describe('deriveTagInventoryRowDescriptors', () => {
    it('ai-user-approved on methods yields row with query from text', () => {
      const descriptors = deriveTagInventoryRowDescriptors([
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
      const descriptors = deriveTagInventoryRowDescriptors([
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

    it('regular annotations create rows with empty query', () => {
      const descriptors = deriveTagInventoryRowDescriptors([
        savedAnn({ id: 'm1', tags: ['methods'], text: 'ignored' }),
      ]);
      assert.deepEqual(descriptors, [{ schemaTag: 'methods', query: '' }]);
    });

    it('ignores replies and system-tag-only annotations', () => {
      const descriptors = deriveTagInventoryRowDescriptors([
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
      const descriptors = deriveTagInventoryRowDescriptors([
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

    it('pruneTagInventoryRowsToDescriptors keeps other groups and drops stale rows', () => {
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
      const pruned = pruneTagInventoryRowsToDescriptors(
        rows,
        [{ schemaTag: 'methods', query: 'q' }],
        groupA,
      );
      assert.deepEqual(
        pruned.map(r => r.id),
        ['1', '3'],
      );
    });

    it('sortTagInventoryRows orders by schemaTag then query', () => {
      const sorted = sortTagInventoryRows([
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

  describe('isTagInventoryRowVisibleInScope', () => {
    const baseRow = {
      id: 'r1',
      schemaTag: 'methods',
      query: 'q',
      annotationIds: [],
      groupId: groupA,
    };

    it('private group: visible when groupId matches', () => {
      assert.isTrue(isTagInventoryRowVisibleInScope(baseRow, privateScope(groupA)));
      assert.isFalse(isTagInventoryRowVisibleInScope(baseRow, privateScope('other')));
    });

    it('public group: visible only when row.documentUri matches currentDocumentUri', () => {
      const publicRow = {
        ...baseRow,
        groupId: PUBLIC_GROUP_ID,
        documentUri: pdf,
      };
      assert.isTrue(
        isTagInventoryRowVisibleInScope(publicRow, publicScope(pdf)),
      );
      assert.isFalse(
        isTagInventoryRowVisibleInScope(publicRow, publicScope(pdfB)),
      );
      assert.isFalse(
        isTagInventoryRowVisibleInScope(publicRow, {
          focusedGroupId: PUBLIC_GROUP_ID,
          currentDocumentUri: null,
        }),
      );
      assert.isFalse(
        isTagInventoryRowVisibleInScope(
          { ...baseRow, groupId: PUBLIC_GROUP_ID },
          publicScope(pdf),
        ),
        'row without documentUri is not visible',
      );
    });

    it('public group: visible when row URN and canonical HTTPS share alias set', () => {
      const urn = 'urn:x-pdf:abc';
      const https = 'https://example.com/paper.pdf';
      const aliases = [urn, https];
      const publicRow = {
        ...baseRow,
        groupId: PUBLIC_GROUP_ID,
        documentUri: urn,
      };
      assert.isTrue(
        isTagInventoryRowVisibleInScope(publicRow, {
          focusedGroupId: PUBLIC_GROUP_ID,
          currentDocumentUri: https,
          documentUriAliases: aliases,
        }),
      );
    });

    it('hides rows missing groupId', () => {
      assert.isFalse(
        isTagInventoryRowVisibleInScope(
          { ...baseRow, groupId: undefined },
          privateScope(groupA),
        ),
      );
    });
  });
});
