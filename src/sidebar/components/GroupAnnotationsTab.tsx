import { useEffect, useState } from 'preact/hooks';

import type { SavedAnnotation } from '../../types/api';
import { quote as annotationQuote } from '../helpers/annotation-metadata';
import { PUBLIC_GROUP_ID } from '../helpers/groups';
import { withServices } from '../service-context';
import {
  savedAnnotationsForCurrentDocument,
  type TagInventoryGroupSyncService,
} from '../services/tag-inventory-group-sync';
import { useSidebarStore } from '../store';
import HighlightedSentence, { type LabeledSpan } from './HighlightedSentence';

type GroupAnnotationsTabProps = {
  tagInventoryGroupSync: TagInventoryGroupSyncService;
};

type ApiSpan = {
  text: string;
  start: number;
  end: number;
  label: number;
};

type CategoryRow = {
  name: string;
  description: string;
};

// Hex colors assigned to labels in order of first appearance.
const LABEL_HEX_COLORS = [
  '#4F46E5', '#059669', '#F59E0B', '#DC2626', '#0EA5E9', '#EC4899', '#8B5CF6', '#D97706',
];

async function fetchSpansBatch(
  sentences: string[],
  categories?: string[],
  categoryDescriptions?: string[],
): Promise<ApiSpan[][]> {
  const body: Record<string, unknown> = { sentences };
  if (categories && categories.length > 0) {
    body.categories = categories;
    if (categoryDescriptions && categoryDescriptions.some(d => d.length > 0)) {
      body.category_descriptions = categoryDescriptions;
    }
  }
  console.log('label-multi-batch request:', body);
  const response = await fetch(
    'https://phrase-labeler.onrender.com/label-multi-batch',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    const errText = await response.text();
    console.error('label-multi-batch error:', response.status, errText);
    throw new Error(`Labeling service error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  console.log('label-multi-batch response:', data);
  const results = (data.results ?? []) as { spans: ApiSpan[] }[];
  return results.map(r => r.spans ?? []);
}

// Shared label index across all annotations in a single highlight run.
type LabelIndex = {
  labelColors: Record<number, string>;
  labelNames: Record<number, string>;
};

function buildLabelIndex(allSpans: ApiSpan[][], categoryNames?: string[]): LabelIndex {
  const seenIds = new Set<number>();
  for (const spans of allSpans) {
    for (const span of spans) {
      if (span.label !== -1) seenIds.add(span.label);
    }
  }
  const labelColors: Record<number, string> = {};
  const labelNames: Record<number, string> = {};
  const sortedIds = [...seenIds].sort((a, b) => a - b);
  sortedIds.forEach((id, colorIndex) => {
    labelColors[id] = LABEL_HEX_COLORS[colorIndex % LABEL_HEX_COLORS.length];
    labelNames[id] = categoryNames?.[id] ?? `Label ${id}`;
  });
  return { labelColors, labelNames };
}

function toLabeled(spans: ApiSpan[]): LabeledSpan[] {
  return spans.map(s => ({
    text: s.text ?? '',
    start: s.start,
    end: s.end,
    label: s.label,
  }));
}

function GroupAnnotationsTab({ tagInventoryGroupSync }: GroupAnnotationsTabProps) {
  const store = useSidebarStore();
  const focusedGroupId = store.focusedGroupId();
  const isFullWidth = store.isSidebarFullWidth();
  const [annotations, setAnnotations] = useState<SavedAnnotation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Category editor state — persists across group changes.
  const [categoryRows, setCategoryRows] = useState<CategoryRow[]>([
    { name: 'Status Quo/Context (the particular context or existing work)', description: '' },
    { name: 'Challenge/Problem/Obstacle (often starts with \'however\', gaps in prior work)', description: '' },
    { name: 'Contribution (what the authors did)', description: '' },
    { name: 'Purpose/Goal/Focus (why the work was done)', description: '' },
    { name: 'Methodology (how the work was done)', description: '' },
    { name: 'Participants (who were involved)', description: '' },
    { name: 'System Description (of a system the authors developed or proposed)', description: '' },
    { name: 'Findings', description: '' },
    { name: 'Example', description: '' },
  ]);

  // Per-annotation API spans (string labels from the server)
  const [rawSpanMap, setRawSpanMap] = useState<Map<string, ApiSpan[]>>(new Map());
  // Shared label index (string → integer ID, color map, name map)
  const [labelIndex, setLabelIndex] = useState<LabelIndex>({
    labelColors: {},
    labelNames: {},
  });
  const [isHighlighting, setIsHighlighting] = useState(false);
  const [highlightError, setHighlightError] = useState<string | null>(null);

  useEffect(() => {
    if (!focusedGroupId) {
      return;
    }
    setIsLoading(true);
    setError(null);

    const fetchAnnotations = async () => {
      try {
        let anns: SavedAnnotation[];
        if (focusedGroupId === PUBLIC_GROUP_ID) {
          anns = savedAnnotationsForCurrentDocument(
            store.savedAnnotations(),
            focusedGroupId,
            store.searchUris(),
          ) as SavedAnnotation[];
        } else {
          anns = await tagInventoryGroupSync.getGroupAnnotations(focusedGroupId);
        }
        setAnnotations(anns);
        setRawSpanMap(new Map());
        setLabelIndex({ labelColors: {}, labelNames: {} });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load annotations',
        );
      } finally {
        setIsLoading(false);
      }
    };

    void fetchAnnotations();
  }, [focusedGroupId]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateCategory = (i: number, field: 'name' | 'description', value: string) => {
    setCategoryRows(rows => {
      const updated = [...rows];
      updated[i] = { ...updated[i], [field]: value };
      return updated;
    });
  };

  const addCategory = () => {
    setCategoryRows(rows => [...rows, { name: '', description: '' }]);
  };

  const removeCategory = (i: number) => {
    setCategoryRows(rows => rows.filter((_, idx) => idx !== i));
  };

  const handleHighlight = async () => {
    setIsHighlighting(true);
    setHighlightError(null);

    try {
      const toProcess = annotations
        .map(ann => ({ ann, sentence: (annotationQuote(ann) ?? '').trim() }))
        .filter(({ sentence }) => sentence.length > 0);

      console.log(`Highlighting ${toProcess.length} annotation(s) in one batch call`);

      const validRows = categoryRows.filter(r => r.name.trim().length > 0);
      const categories = validRows.length > 0
        ? validRows.map(r => r.name.trim())
        : undefined;
      const categoryDescriptions = validRows.length > 0
        ? validRows.map(r => r.description.trim())
        : undefined;

      const sentences = toProcess.map(({ sentence }) => sentence);
      const batchSpans = await fetchSpansBatch(sentences, categories, categoryDescriptions);

      const newRawSpanMap = new Map<string, ApiSpan[]>();
      for (let i = 0; i < toProcess.length; i++) {
        newRawSpanMap.set(toProcess[i].ann.id, batchSpans[i] ?? []);
      }

      const index = buildLabelIndex([...newRawSpanMap.values()], categories);
      setRawSpanMap(newRawSpanMap);
      setLabelIndex(index);
    } catch (err) {
      setHighlightError(
        err instanceof Error ? err.message : 'Highlighting failed',
      );
    } finally {
      setIsHighlighting(false);
    }
  };

  if (isLoading) {
    return (
      <p className="text-center text-color-text-light p-4">
        Loading annotations…
      </p>
    );
  }

  if (error) {
    return <p className="text-center text-color-text-light p-4">{error}</p>;
  }

  if (annotations.length === 0) {
    return (
      <p className="text-center text-color-text-light p-4">
        No annotations in this group.
      </p>
    );
  }

  // Build an ordered map: tag → annotations.
  const tagMap = new Map<string, SavedAnnotation[]>();
  for (const ann of annotations) {
    const tags = ann.tags.length > 0 ? ann.tags : [''];
    for (const tag of tags) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag)!.push(ann);
    }
  }

  const sortedTags = [...tagMap.keys()]
    .filter(t => t !== '')
    .sort((a, b) => a.localeCompare(b));
  if (tagMap.has('')) sortedTags.push('');

  const hasHighlights = rawSpanMap.size > 0;
  const legendEntries = Object.entries(labelIndex.labelColors)
    .sort((a, b) => Number(a[0]) - Number(b[0]));

  return (
    <div className="flex flex-col gap-y-3">
      {/* Category editor */}
      <div className="flex flex-col gap-y-1 px-2 pt-2">
        <p className="text-xs font-semibold text-color-text-light uppercase tracking-wide mb-1">
          Categories
        </p>
        {categoryRows.map((row, i) => (
          <div key={i} className="flex gap-x-1 items-center">
            <input
              type="text"
              placeholder="Name"
              value={row.name}
              onChange={e => updateCategory(i, 'name', (e.target as HTMLInputElement).value)}
              className="w-24 shrink-0 text-xs px-1.5 py-1 border border-grey-3 rounded bg-white"
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={row.description}
              onChange={e => updateCategory(i, 'description', (e.target as HTMLInputElement).value)}
              className="flex-1 min-w-0 text-xs px-1.5 py-1 border border-grey-3 rounded bg-white"
            />
            <button
              className="shrink-0 text-sm leading-none text-color-text-light hover:text-color-text px-1"
              onClick={() => removeCategory(i)}
              title="Remove row"
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="text-xs text-left text-color-text-light hover:text-color-text mt-0.5"
          onClick={addCategory}
        >
          + Add category
        </button>
      </div>

      {/* Highlight toolbar */}
      <div className="flex items-center gap-x-2 px-2">
        <button
          className="text-xs px-2 py-1 rounded border border-grey-3 bg-white hover:bg-grey-1 disabled:opacity-50"
          onClick={handleHighlight}
          disabled={isHighlighting}
        >
          {isHighlighting ? 'Highlighting…' : 'Highlight'}
        </button>
        {highlightError && (
          <span className="text-xs" style={{ color: '#dc2626' }}>{highlightError}</span>
        )}
      </div>

      {/* Legend — shown in full-width mode when highlights are present */}
      {isFullWidth && hasHighlights && legendEntries.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-2">
          {legendEntries.map(([id, color]) => (
            <span key={id} className="flex items-center gap-x-1 text-xs">
              <span
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '2px',
                  backgroundColor: color,
                }}
              />
              {labelIndex.labelNames[Number(id)]}
            </span>
          ))}
        </div>
      )}

      {/* Tag sections */}
      {sortedTags.map(tag => (
        <section key={tag || '__untagged__'}>
          <h3 className="text-sm font-bold text-color-text px-2 py-1 bg-grey-1 border-b border-grey-3 sticky top-0">
            {tag || 'Untagged'}
          </h3>
          <ul className="flex flex-col gap-y-2 mt-2">
            {tagMap.get(tag)!.map(ann => {
              const excerptText = annotationQuote(ann);
              const rawSpans = rawSpanMap.get(ann.id);
              const labeledSpans = rawSpans ? toLabeled(rawSpans) : [];
              return (
                <li
                  key={ann.id}
                  className="border border-grey-3 rounded p-2 text-sm bg-white mx-2"
                >
                  <p className="text-xs text-color-text-light truncate mb-1">
                    {ann.document?.title || ann.uri}
                  </p>
                  {excerptText && (
                    <blockquote className="border-l-2 border-grey-4 pl-2 italic text-color-text-light text-xs mb-1">
                      {isFullWidth && labeledSpans.length > 0 ? (
                        <HighlightedSentence
                          original={excerptText}
                          spans={labeledSpans}
                          labelColors={labelIndex.labelColors}
                          labelNames={labelIndex.labelNames}
                          mode="highlight"
                        />
                      ) : (
                        excerptText
                      )}
                    </blockquote>
                  )}
                  {ann.text && (
                    <p className="text-color-text text-sm">{ann.text}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default withServices(GroupAnnotationsTab, ['tagInventoryGroupSync']);
