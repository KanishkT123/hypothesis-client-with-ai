import type { SavedAnnotation } from '../../types/api';
import type { AISearchRow } from '../store/modules/sidebar-panels';
import { isReply, isSaved } from './annotation-metadata';
import { PUBLIC_GROUP_ID } from './groups';

/**
 * AI search schema tag helpers.
 *
 * Annotations carry Hypothesis **tags**. Besides system tags (`ai-pending`,
 * `ai-user-approved`), **schema tags** drive the history table and Claude few-shot
 * examples:
 *
 * - **Positive schema tag** — e.g. `methods` (match / teach the model what to find)
 * - **Negative schema tag** — e.g. `methods-neg-example` (teach what not to find;
 *   created on deny or by manual tag edit)
 *
 * These helpers classify tag strings and filter annotation tag lists. They do not
 * read annotation bodies or quotes.
 */

/** Suffix for negative schema tags derived from a positive schema tag. */
export const NEG_EXAMPLE_SCHEMA_TAG_SUFFIX = '-neg-example';

const AI_USER_APPROVED = 'ai-user-approved';
const AI_PENDING = 'ai-pending';

const DESCRIPTOR_SEP = '\0';

/** One history row per `(schemaTag, query)` within a group — not per document. */
export type AISearchHistoryRowDescriptor = {
  schemaTag: string;
  query: string;
};

export type ScopedAISearchRow = AISearchRow & {
  groupId?: string;
};

function norm(value: string): string {
  return value.trim();
}

function isAiSearchSystemTag(tag: string): boolean {
  return tag === AI_USER_APPROVED || tag === AI_PENDING;
}

/**
 * True when `tag` is a positive content tag that can be converted to
 * `{tag}-neg-example` (not a system tag, not already negative).
 */
export function isConvertiblePositiveContentTag(tag: string): boolean {
  return !isAiSearchSystemTag(tag) && !isNegativeSchemaTag(tag);
}

/** Positive schema tag name for a negative schema tag, or null if not negative. */
export function positiveSchemaTagForNegativeTag(
  negativeTag: string,
): string | null {
  if (!isNegativeSchemaTag(negativeTag)) {
    return null;
  }
  return negativeTag.slice(0, -NEG_EXAMPLE_SCHEMA_TAG_SUFFIX.length);
}

/**
 * Replace one positive content tag with its `-neg-example` variant; strip
 * AI search system tags. Returns null if the tag cannot be converted.
 */
export function retagOnePositiveSchemaTagAsNegative(
  tags: string[],
  positiveTag: string,
): string[] | null {
  if (!isConvertiblePositiveContentTag(positiveTag) || !tags.includes(positiveTag)) {
    return null;
  }
  const withoutClickedAndSystem = tags.filter(
    t => t !== positiveTag && !isAiSearchSystemTag(t),
  );
  return [
    ...withoutClickedAndSystem,
    negativeSchemaTagForPositiveTag(positiveTag),
  ];
}

/**
 * Replace one negative schema tag with its positive form. Returns null if the
 * tag is not a negative schema tag or is absent from `tags`.
 */
export function retagOneNegativeSchemaTagAsPositive(
  tags: string[],
  negativeTag: string,
): string[] | null {
  const positiveTag = positiveSchemaTagForNegativeTag(negativeTag);
  if (!positiveTag || !tags.includes(negativeTag)) {
    return null;
  }
  return tags.map(t => (t === negativeTag ? positiveTag : t));
}

/** Whether a pill may offer "mark as negative example" for `tag`. */
export function canMarkTagAsNegativeExample(
  annotationTags: string[],
  tag: string,
): boolean {
  return (
    !annotationTags.includes(AI_PENDING) &&
    isConvertiblePositiveContentTag(tag)
  );
}

/** Whether a pill may offer "revert to positive example" for `tag`. */
export function canRevertNegativeExampleTag(
  annotationTags: string[],
  tag: string,
): boolean {
  return (
    !annotationTags.includes(AI_PENDING) && isNegativeSchemaTag(tag)
  );
}

/**
 * Convert all positive schema tags to `-neg-example` variants; strip system
 * tags and positive schema tags from the retained set.
 */
export function retagAllPositiveSchemaTagsAsNegative(tags: string[]): string[] {
  const positives = positiveSchemaTags(tags);
  const negativeTags = positives.map(negativeSchemaTagForPositiveTag);
  const retainedTags = tags.filter(
    t =>
      !isAiSearchSystemTag(t) &&
      !positives.includes(t),
  );
  return [...new Set([...retainedTags, ...negativeTags])];
}

/**
 * True when `tag` is a negative schema tag (`{name}-neg-example`).
 */
export function isNegativeSchemaTag(tag: string): boolean {
  const trimmed = tag.trim();
  if (!trimmed.endsWith(NEG_EXAMPLE_SCHEMA_TAG_SUFFIX)) {
    return false;
  }
  return trimmed.length > NEG_EXAMPLE_SCHEMA_TAG_SUFFIX.length;
}

/**
 * Build the negative schema tag for a positive one (`methods` → `methods-neg-example`).
 */
export function negativeSchemaTagForPositiveTag(positiveSchemaTag: string): string {
  return `${norm(positiveSchemaTag)}${NEG_EXAMPLE_SCHEMA_TAG_SUFFIX}`;
}

/**
 * Positive schema tags on an annotation: not system tags, not negative schema tags.
 */
export function positiveSchemaTags(annotationTags: string[]): string[] {
  return annotationTags.filter(
    tag => !isAiSearchSystemTag(tag) && !isNegativeSchemaTag(tag),
  );
}

/**
 * Negative schema tags on an annotation (tags ending with `-neg-example`).
 */
export function negativeSchemaTags(annotationTags: string[]): string[] {
  return annotationTags.filter(isNegativeSchemaTag);
}

/** Stable key for a history row: `(schemaTag, query)` within one group. */
export function rowDescriptorKey(schemaTag: string, query: string): string {
  return `${norm(schemaTag)}${DESCRIPTOR_SEP}${norm(query)}`;
}

/**
 * Derive history row descriptors from annotations (positive + negative schema tags).
 * Dedupes by `(schemaTag, query)` across all input annotations (including cross-URL
 * in a private group).
 */
export function deriveAISearchHistoryRowDescriptors(
  annotations: SavedAnnotation[],
): AISearchHistoryRowDescriptor[] {
  const seen = new Set<string>();
  const out: AISearchHistoryRowDescriptor[] = [];

  const push = (descriptor: AISearchHistoryRowDescriptor) => {
    const key = rowDescriptorKey(descriptor.schemaTag, descriptor.query);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(descriptor);
  };

  for (const ann of annotations) {
    if (!isSaved(ann) || isReply(ann)) {
      continue;
    }

    const tags = ann.tags ?? [];
    const textQuery = norm(ann.text ?? '');

    if (tags.includes(AI_USER_APPROVED)) {
      for (const schemaTag of positiveSchemaTags(tags)) {
        push({ schemaTag, query: textQuery });
      }
      continue;
    }

    const negativeTags = negativeSchemaTags(tags);
    if (negativeTags.length > 0) {
      for (const schemaTag of negativeTags) {
        push({ schemaTag, query: textQuery });
      }
      continue;
    }

    if (tags.includes(AI_PENDING)) {
      continue;
    }

    for (const schemaTag of positiveSchemaTags(tags)) {
      push({ schemaTag, query: '' });
    }
  }

  return out;
}

/** History table visibility for the focused group. */
export function isAISearchRowVisibleInScope(
  row: ScopedAISearchRow,
  scope: {
    focusedGroupId: string;
    /**
     * Public (`__world__`) only: descriptor keys derived/upserted for the
     * **current document**. Rows outside this set stay stored (colors) but hidden.
     */
    publicDocumentDescriptorKeys?: ReadonlySet<string> | null;
  },
): boolean {
  if (row.groupId !== scope.focusedGroupId) {
    return false;
  }
  if (scope.focusedGroupId === PUBLIC_GROUP_ID) {
    if (!scope.publicDocumentDescriptorKeys) {
      return false;
    }
    return scope.publicDocumentDescriptorKeys.has(
      rowDescriptorKey(row.schemaTag, row.query),
    );
  }
  return true;
}

/**
 * Keep rows for other groups; for `groupId`, drop rows whose `(schemaTag, query)`
 * no longer appears in the derived set (annotation deleted on server).
 */
export function pruneAISearchRowsToDescriptors(
  rows: ScopedAISearchRow[],
  descriptors: AISearchHistoryRowDescriptor[],
  groupId: string,
): ScopedAISearchRow[] {
  const allowed = new Set(
    descriptors.map(d => rowDescriptorKey(d.schemaTag, d.query)),
  );

  return rows.filter(row => {
    if (row.groupId !== groupId) {
      return true;
    }
    return allowed.has(rowDescriptorKey(row.schemaTag, row.query));
  });
}

export function sortAISearchRows<T extends AISearchRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const tagCmp = norm(a.schemaTag).localeCompare(norm(b.schemaTag), undefined, {
      sensitivity: 'base',
    });
    if (tagCmp !== 0) {
      return tagCmp;
    }
    return norm(a.query).localeCompare(norm(b.query), undefined, {
      sensitivity: 'base',
    });
  });
}
