import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import type { SavedAnnotation } from '../../types/api';
import { quote as annotationQuote } from '../helpers/annotation-metadata';
import { PUBLIC_GROUP_ID } from '../helpers/groups';
import { withServices } from '../service-context';
import {
  savedAnnotationsForCurrentDocument,
  type TagInventoryGroupSyncService,
} from '../services/tag-inventory-group-sync';
import { useSidebarStore } from '../store';
import HighlightedSentence, { type LabeledSpan, type RenderMode } from './HighlightedSentence';

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

const CATEGORY_ROWS_KEY = 'hypothesis-category-rows';

// Returns true if `spans` contains each category in `categoryIds` in order:
// each category's span must start after the previous category's span ends.
function hasSequence(spans: ApiSpan[], categoryIds: number[]): boolean {
  let minPos = 0;
  for (const catId of categoryIds) {
    const span = spans
      .filter(s => s.label === catId && s.start >= minPos)
      .sort((a, b) => a.start - b.start)[0];
    if (!span) return false;
    minPos = span.end;
  }
  return true;
}
const highlightCacheKey = (groupId: string) => `hypothesis-highlights-${groupId}`;

const DEFAULT_CATEGORY_ROWS: CategoryRow[] = [
  { name: 'Status Quo/Context (the particular context or existing work)', description: '' },
  { name: "Challenge/Problem/Obstacle (often starts with 'however', gaps in prior work)", description: '' },
  { name: 'Contribution (what the authors did)', description: '' },
  { name: 'Purpose/Goal/Focus (why the work was done)', description: '' },
  { name: 'Methodology (how the work was done)', description: '' },
  { name: 'Participants (who were involved)', description: '' },
  { name: 'System Description (of a system the authors developed or proposed)', description: '' },
  { name: 'Findings', description: '' },
  { name: 'Example', description: '' },
];

// Hex colors assigned to labels in order of first appearance.
const LABEL_HEX_COLORS = [
  '#4F46E5', '#059669', '#F59E0B', '#DC2626', '#0EA5E9', '#EC4899', '#8B5CF6', '#D97706',
];

// Measure the rendered pixel width of a string as it would appear in the
// blockquote (text-xs italic). Used to compute alignment padding.
const _measureCanvas = document.createElement('canvas');
function measureTextWidth(text: string): number {
  const ctx = _measureCanvas.getContext('2d');
  if (!ctx) return 0;
  ctx.font = 'italic 12px ui-sans-serif, system-ui, -apple-system, sans-serif';
  return ctx.measureText(text).width;
}

// Merge consecutive spans that share the same label and are adjacent in position
// (gap of at most 1 character, i.e., a single whitespace between them).
function mergeAdjacentSpans(spans: ApiSpan[]): ApiSpan[] {
  if (spans.length === 0) return spans;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: ApiSpan[] = [];
  for (const span of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && prev.label === span.label && span.start <= prev.end + 1) {
      prev.end = Math.max(prev.end, span.end);
      prev.text = prev.text + ' ' + span.text;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

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
  return results.map(r => mergeAdjacentSpans(r.spans ?? []));
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

// Split text and spans at two boundaries: [0, leftEnd) goes left, [rightStart, end) goes right.
// Text between the two boundaries is dropped, giving a clean gap between the columns.
function splitAtTwoOffsets(
  original: string,
  spans: LabeledSpan[],
  leftEnd: number,
  rightStart: number,
): {
  left: { text: string; spans: LabeledSpan[] };
  right: { text: string; spans: LabeledSpan[] };
} {
  const rs = Math.max(leftEnd, rightStart);
  const leftText = original.slice(0, leftEnd);
  const rightText = original.slice(rs);

  const leftSpans = spans
    .filter(s => s.start < leftEnd)
    .map(s => ({ ...s, end: Math.min(s.end, leftEnd) }));

  const rightSpans = spans
    .filter(s => s.end > rs)
    .map(s => ({
      ...s,
      start: Math.max(s.start, rs) - rs,
      end: s.end - rs,
      text: original.slice(Math.max(s.start, rs), s.end),
    }));

  return {
    left: { text: leftText, spans: leftSpans },
    right: { text: rightText, spans: rightSpans },
  };
}

// Split text and spans at a character offset for the two-column alignment layout.
function splitAtOffset(
  original: string,
  spans: LabeledSpan[],
  offset: number,
): {
  left: { text: string; spans: LabeledSpan[] };
  right: { text: string; spans: LabeledSpan[] };
} {
  const leftText = original.slice(0, offset);
  const rightText = original.slice(offset);

  const leftSpans = spans
    .filter(s => s.start < offset)
    .map(s => ({ ...s, end: Math.min(s.end, offset) }));

  const rightSpans = spans
    .filter(s => s.end > offset)
    .map(s => ({
      ...s,
      start: Math.max(s.start, offset) - offset,
      end: s.end - offset,
      text: original.slice(Math.max(s.start, offset), s.end),
    }));

  return {
    left: { text: leftText, spans: leftSpans },
    right: { text: rightText, spans: rightSpans },
  };
}

function GroupAnnotationsTab({ tagInventoryGroupSync }: GroupAnnotationsTabProps) {
  const store = useSidebarStore();
  const focusedGroupId = store.focusedGroupId();
  const isFullWidth = store.isSidebarFullWidth();

  // For the public group, derive annotations from the store directly so the list
  // stays reactive: any new annotation created in this session appears immediately.
  // For private groups the API fetch is used (see the useEffect below).
  const storeAnnotations = store.savedAnnotations();
  const searchUris = store.searchUris();
  const [fetchedAnnotations, setFetchedAnnotations] = useState<SavedAnnotation[]>([]);
  const annotations: SavedAnnotation[] = focusedGroupId === PUBLIC_GROUP_ID
    ? (savedAnnotationsForCurrentDocument(storeAnnotations, focusedGroupId, searchUris) as SavedAnnotation[])
    : fetchedAnnotations;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Category editor state — loaded from localStorage, saved on every change.
  const [categoryRows, setCategoryRows] = useState<CategoryRow[]>(() => {
    try {
      const stored = localStorage.getItem(CATEGORY_ROWS_KEY);
      if (stored) return JSON.parse(stored) as CategoryRow[];
    } catch {}
    return DEFAULT_CATEGORY_ROWS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(CATEGORY_ROWS_KEY, JSON.stringify(categoryRows));
    } catch {}
  }, [categoryRows]);

  // Per-annotation API spans (string labels from the server)
  const [rawSpanMap, setRawSpanMap] = useState<Map<string, ApiSpan[]>>(new Map());
  // Shared label index (string → integer ID, color map, name map)
  const [labelIndex, setLabelIndex] = useState<LabelIndex>({
    labelColors: {},
    labelNames: {},
  });
  const [isHighlighting, setIsHighlighting] = useState(false);
  const [highlightError, setHighlightError] = useState<string | null>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>('highlight');
  const [activeLabels, setActiveLabels] = useState<Set<number> | undefined>(undefined);
  const [searchText, setSearchText] = useState('');
  const [searchCategoryIds, setSearchCategoryIds] = useState<number[]>([]);
  // Category names/descriptions that were active during the last highlight run.
  // undefined = no highlight has been run yet this session.
  const [highlightedCategories, setHighlightedCategories] = useState<string[] | undefined>(undefined);
  const [highlightedDescriptions, setHighlightedDescriptions] = useState<string[] | undefined>(undefined);

  // Any dropped categories → aligned view; zero → normal view.
  const alignCategory = searchCategoryIds.length >= 1 ? searchCategoryIds[0] : null;
  const contentRef = useRef<HTMLDivElement>(null);
  const alignedScrollRef = useRef<HTMLDivElement>(null);

  // After the aligned table renders, scroll so the column boundary is centered.
  useEffect(() => {
    if (alignCategory === null || !isFullWidth) return;
    const container = alignedScrollRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      // First <td> in the table is always a header cell in column 1.
      // Table layout guarantees all column-1 cells share the same width.
      const firstTd = container.querySelector('td') as HTMLElement | null;
      if (!firstTd) return;
      const leftColWidth = firstTd.getBoundingClientRect().width;
      container.scrollLeft = leftColWidth - container.clientWidth / 2;
    });
  }, [alignCategory, searchCategoryIds.length, isFullWidth, rawSpanMap]);

  useEffect(() => {
    if (!focusedGroupId) {
      return;
    }

    const restoreCache = () => {
      try {
        const cached = localStorage.getItem(highlightCacheKey(focusedGroupId));
        if (cached) {
          const { rawSpans, categories: cats, categoryDescriptions: descs } = JSON.parse(cached) as {
            rawSpans: Record<string, ApiSpan[]>;
            categories: string[] | undefined;
            categoryDescriptions: string[] | undefined;
          };
          const restoredMap = new Map<string, ApiSpan[]>(
            Object.entries(rawSpans).map(([id, spans]) => [id, mergeAdjacentSpans(spans)]),
          );
          const index = buildLabelIndex([...restoredMap.values()], cats);
          setRawSpanMap(restoredMap);
          setLabelIndex(index);
          setActiveLabels(new Set(Object.keys(index.labelColors).map(Number)));
          setHighlightedCategories(cats ?? []);
          setHighlightedDescriptions(descs ?? []);
          return;
        }
      } catch {}
      setRawSpanMap(new Map());
      setLabelIndex({ labelColors: {}, labelNames: {} });
      setActiveLabels(undefined);
    };

    if (focusedGroupId === PUBLIC_GROUP_ID) {
      // Annotations are derived from the store reactively above — no fetch needed.
      restoreCache();
      return;
    }

    // Private group: fetch annotation list from the API.
    setIsLoading(true);
    setError(null);

    const fetchAnnotations = async () => {
      try {
        const anns = await tagInventoryGroupSync.getGroupAnnotations(focusedGroupId);
        setFetchedAnnotations(anns);
        restoreCache();
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

  // Per-annotation left-padding (px) so the first span of alignCategory
  // starts at the horizontal center of the content area.
  const alignPaddings = useMemo<Map<string, number> | null>(() => {
    if (alignCategory === null || rawSpanMap.size === 0) return null;
    const containerWidth = contentRef.current?.offsetWidth ?? 300;
    const targetX = containerWidth / 2;
    const paddings = new Map<string, number>();
    for (const ann of annotations) {
      const original = (annotationQuote(ann) ?? '').trim();
      const spans = rawSpanMap.get(ann.id) ?? [];
      const firstSpan = spans.find(s => s.label === alignCategory);
      // No matching span → treat as if category is at position 0 (all text is "after").
      const prefixText = firstSpan ? original.slice(0, firstSpan.start) : '';
      const prefixWidth = measureTextWidth(prefixText);
      paddings.set(ann.id, Math.max(0, targetX - prefixWidth));
    }
    return paddings;
  }, [alignCategory, annotations, rawSpanMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLabel = (labelId: number) => {
    setActiveLabels(prev => {
      const next = new Set(prev ?? Object.keys(labelIndex.labelColors).map(Number));
      if (next.has(labelId)) {
        next.delete(labelId);
      } else {
        next.add(labelId);
      }
      return next;
    });
  };

  const handleHighlight = async () => {
    setIsHighlighting(true);
    setHighlightError(null);

    try {
      const validRows = categoryRows.filter(r => r.name.trim().length > 0);
      const categories = validRows.length > 0
        ? validRows.map(r => r.name.trim())
        : undefined;
      const categoryDescriptions = validRows.length > 0
        ? validRows.map(r => r.description.trim())
        : undefined;

      // Full re-highlight when categories changed or no existing spans.
      const currentCats = categories ?? [];
      const currentDescs = categoryDescriptions ?? [];
      const catsDiffer = highlightedCategories === undefined ||
        highlightedCategories.length !== currentCats.length ||
        highlightedCategories.some((c, i) => c !== currentCats[i]) ||
        (highlightedDescriptions ?? []).length !== currentDescs.length ||
        (highlightedDescriptions ?? []).some((d, i) => d !== currentDescs[i]);
      const isFullRun = catsDiffer || rawSpanMap.size === 0;

      const allCandidates = annotations
        .map(ann => ({ ann, sentence: (annotationQuote(ann) ?? '').trim() }))
        .filter(({ sentence }) => sentence.length > 0);

      // Incremental: skip annotations that already have spans.
      const toProcess = isFullRun
        ? allCandidates
        : allCandidates.filter(({ ann }) => !rawSpanMap.has(ann.id));

      if (toProcess.length === 0) return;

      console.log(`Highlighting ${toProcess.length} annotation(s) (${isFullRun ? 'full' : 'incremental'})`);

      const sentences = toProcess.map(({ sentence }) => sentence);
      const batchSpans = await fetchSpansBatch(sentences, categories, categoryDescriptions);

      // Start from existing map for incremental runs; fresh map for full runs.
      const newRawSpanMap = new Map<string, ApiSpan[]>(isFullRun ? [] : rawSpanMap);
      for (let i = 0; i < toProcess.length; i++) {
        newRawSpanMap.set(toProcess[i].ann.id, batchSpans[i] ?? []);
      }

      const index = buildLabelIndex([...newRawSpanMap.values()], categories);
      setRawSpanMap(newRawSpanMap);
      setLabelIndex(index);
      setActiveLabels(new Set(Object.keys(index.labelColors).map(Number)));
      setHighlightedCategories(currentCats);
      setHighlightedDescriptions(currentDescs);

      // Persist so highlights survive page reloads.
      try {
        if (focusedGroupId) {
          localStorage.setItem(
            highlightCacheKey(focusedGroupId),
            JSON.stringify({
              rawSpans: Object.fromEntries(newRawSpanMap),
              categories,
              categoryDescriptions,
            }),
          );
        }
      } catch {}
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

  // Filter by search keyword before building the tag map.
  const q = searchText.trim().toLowerCase();
  const visibleAnnotations = q
    ? annotations.filter(ann =>
        (annotationQuote(ann) ?? '').toLowerCase().includes(q),
      )
    : annotations;

  // Build an ordered map: tag → annotations.
  const tagMap = new Map<string, SavedAnnotation[]>();
  for (const ann of visibleAnnotations) {
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
  const validCategories = categoryRows.filter(r => r.name.trim().length > 0).map(r => r.name.trim());
  const validDescriptions = categoryRows.filter(r => r.name.trim().length > 0).map(r => r.description.trim());
  const categoriesDiffer = hasHighlights &&
    highlightedCategories !== undefined &&
    (highlightedCategories.length !== validCategories.length ||
     highlightedCategories.some((c, i) => c !== validCategories[i]) ||
     (highlightedDescriptions ?? []).length !== validDescriptions.length ||
     (highlightedDescriptions ?? []).some((d, i) => d !== validDescriptions[i]));
  const legendEntries = Object.entries(labelIndex.labelColors)
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  const allLabelsActive =
    legendEntries.length > 0 &&
    legendEntries.every(([id]) => activeLabels?.has(Number(id)) ?? true);

  return (
    <div className="flex flex-col gap-y-3" ref={contentRef}>
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
          className={`text-xs px-2 py-1 rounded border disabled:opacity-50 ${
            categoriesDiffer
              ? 'border-yellow-400 bg-yellow-50 text-yellow-800 hover:bg-yellow-100'
              : 'border-grey-3 bg-white hover:bg-grey-1'
          }`}
          onClick={handleHighlight}
          disabled={isHighlighting}
          title={categoriesDiffer ? 'Categories changed — clicking will re-highlight all annotations' : undefined}
        >
          {isHighlighting ? 'Highlighting…' : categoriesDiffer ? '⚠ Highlight' : 'Highlight'}
        </button>
        <div className="inline-flex rounded border border-grey-3 bg-white p-0.5 text-xs">
          <button
            onClick={() => setRenderMode('underline')}
            className={`px-2 py-0.5 rounded-sm ${
              renderMode === 'underline'
                ? 'bg-indigo-100 text-indigo-700 font-medium'
                : 'text-color-text-light hover:text-color-text'
            }`}
          >
            Underline
          </button>
          <button
            onClick={() => setRenderMode('highlight')}
            className={`px-2 py-0.5 rounded-sm ${
              renderMode === 'highlight'
                ? 'bg-indigo-100 text-indigo-700 font-medium'
                : 'text-color-text-light hover:text-color-text'
            }`}
          >
            Highlight
          </button>
        </div>
        {highlightError && (
          <span className="text-xs" style={{ color: '#dc2626' }}>{highlightError}</span>
        )}
      </div>

      {/* Search bar — accepts typed keywords and dragged category chips */}
      <div className="px-2">
        <div
          className="flex flex-wrap items-center gap-1 px-2 py-1 border border-grey-3 rounded bg-white min-h-[28px] cursor-text"
          onDragOver={(e: DragEvent) => { e.preventDefault(); (e as DragEvent).dataTransfer!.dropEffect = 'copy'; }}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            const raw = (e as DragEvent).dataTransfer?.getData('application/x-category-id');
            if (!raw) return;
            const id = Number(raw);
            setSearchCategoryIds(prev => prev.includes(id) ? prev : [...prev, id]);
          }}
        >
          {searchCategoryIds.map((id, idx) => {
            const color = labelIndex.labelColors[id];
            const name = labelIndex.labelNames[id] ?? `Label ${id}`;
            return (
              <span
                key={idx}
                className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded font-medium"
                style={{ backgroundColor: color, color: 'white' }}
              >
                {name}
                <button
                  style={{ lineHeight: 1, opacity: 0.8 }}
                  onClick={() => setSearchCategoryIds(prev => prev.filter((_, i) => i !== idx))}
                >
                  ×
                </button>
              </span>
            );
          })}
          <input
            type="text"
            value={searchText}
            onInput={(e: Event) => setSearchText((e.target as HTMLInputElement).value)}
            placeholder={searchCategoryIds.length === 0 ? 'Search or drop a category…' : ''}
            className="flex-1 min-w-[80px] text-xs outline-none bg-transparent text-color-text"
          />
        </div>
      </div>

      {/* Legend — shown in full-width mode when highlights are present */}
      {hasHighlights && legendEntries.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-1 px-2 items-center">
          <button
            onClick={() =>
              allLabelsActive
                ? setActiveLabels(new Set())
                : setActiveLabels(new Set(legendEntries.map(([id]) => Number(id))))
            }
            className="text-xs px-2 py-0.5 rounded border border-grey-3 hover:bg-grey-1 text-color-text-light"
            style={{ backgroundColor: allLabelsActive ? '#ececec' : 'white' }}
          >
            {allLabelsActive ? 'None' : 'All'}
          </button>
          {legendEntries.map(([id, color]) => {
            const labelId = Number(id);
            const isActive = activeLabels?.has(labelId) ?? true;
            return (
              <button
                key={id}
                draggable
                onDragStart={(e: DragEvent) => {
                  e.dataTransfer!.setData('application/x-category-id', String(labelId));
                  e.dataTransfer!.effectAllowed = 'copy';
                }}
                onClick={() => toggleLabel(labelId)}
                className="text-xs px-2 py-0.5 rounded border-2 font-medium transition-colors cursor-grab"
                style={{
                  borderColor: color,
                  backgroundColor: isActive ? color : 'transparent',
                  color: isActive ? 'white' : '#374151',
                }}
              >
                {labelIndex.labelNames[labelId]}
              </button>
            );
          })}
        </div>
      )}

      {/* Tag sections */}
      {alignCategory !== null && isFullWidth ? (
        // Aligned mode: HTML table so all rows share the same column widths automatically.
        // Headers use position:sticky left:0 on a single-column <td> — the standard
        // "frozen first column" pattern. The <tr> background fills the full row width,
        // so headers appear static while annotation rows scroll horizontally.
        <div ref={alignedScrollRef} style={{ overflowX: 'auto' }}>
          <table style={{ tableLayout: 'auto', borderCollapse: 'separate', borderSpacing: 0 }}>
            <tbody>
              {sortedTags.flatMap(tag => {
                const sortedAnns = [...tagMap.get(tag)!].sort((a, b) => {
                  if (searchCategoryIds.length >= 2) {
                    const aSeq = hasSequence(rawSpanMap.get(a.id) ?? [], searchCategoryIds) ? 0 : 1;
                    const bSeq = hasSequence(rawSpanMap.get(b.id) ?? [], searchCategoryIds) ? 0 : 1;
                    return aSeq - bSeq;
                  }
                  const aHas = rawSpanMap.get(a.id)?.some(s => s.label === alignCategory) ? 0 : 1;
                  const bHas = rawSpanMap.get(b.id)?.some(s => s.label === alignCategory) ? 0 : 1;
                  return aHas - bHas;
                });
                return [
                  <tr key={`header-${tag || '__untagged__'}`}>
                    <td
                      style={{ position: 'sticky', left: 0, zIndex: 1 }}
                      className="text-sm font-bold text-color-text px-2 py-1 bg-grey-1 border-b border-grey-3"
                    >
                      {tag || 'Untagged'}
                    </td>
                    <td className="bg-grey-1 border-b border-grey-3" />
                  </tr>,
                  ...sortedAnns.flatMap(ann => {
                    const excerptText = annotationQuote(ann);
                    if (!excerptText) return [];
                    const rawSpans = rawSpanMap.get(ann.id);
                    const labeledSpans = rawSpans ? toLabeled(rawSpans) : [];
                    console.log('[GroupAnnotationsTab] spans for ann', ann.id, {
                      spans: (rawSpans ?? []).map(s => ({
                        label: s.label,
                        category: labelIndex.labelNames[s.label] ?? `Label ${s.label}`,
                        start: s.start,
                        end: s.end,
                        text: s.text,
                      })),
                      searchCategoryIds: searchCategoryIds.map(id => ({
                        id,
                        name: labelIndex.labelNames[id] ?? `Label ${id}`,
                      })),
                    });
                    let left: { text: string; spans: LabeledSpan[] };
                    let right: { text: string; spans: LabeledSpan[] };
                    if (searchCategoryIds.length >= 2) {
                      const firstCat = rawSpans?.find(s => s.label === searchCategoryIds[0]);
                      const secondCat = rawSpans?.find(s => s.label === searchCategoryIds[1]);
                      const leftEnd = firstCat?.end ?? 0;
                      const rightStart = secondCat?.start ?? leftEnd;
                      console.log('[GroupAnnotationsTab] 2-cat split', ann.id, {leftEnd, rightStart, firstCat, secondCat});
                      ({ left, right } = splitAtTwoOffsets(excerptText, labeledSpans, leftEnd, rightStart));
                    } else {
                      const firstAlignSpan = rawSpans?.find(s => s.label === alignCategory);
                      const splitOffset = firstAlignSpan?.start ?? 0;
                      console.log('[GroupAnnotationsTab] 1-cat split', ann.id, {alignCategory, splitOffset, firstAlignSpan});
                      ({ left, right } = splitAtOffset(excerptText, labeledSpans, splitOffset));
                    }
                    return [
                      <tr key={ann.id}>
                        <td
                          className="italic text-color-text-light text-xs py-0.5"
                          style={{ paddingRight: '2px', whiteSpace: 'nowrap', textAlign: 'right' }}
                        >
                          {left.spans.length > 0 ? (
                            <HighlightedSentence
                              original={left.text}
                              spans={left.spans}
                              labelColors={labelIndex.labelColors}
                              labelNames={labelIndex.labelNames}
                              activeLabels={activeLabels}
                              mode={renderMode}
                            />
                          ) : left.text}
                        </td>
                        <td
                          className="italic text-color-text-light text-xs py-0.5"
                          style={{ paddingLeft: '2px', whiteSpace: 'nowrap' }}
                        >
                          {right.spans.length > 0 ? (
                            <HighlightedSentence
                              original={right.text}
                              spans={right.spans}
                              labelColors={labelIndex.labelColors}
                              labelNames={labelIndex.labelNames}
                              activeLabels={activeLabels}
                              mode={renderMode}
                            />
                          ) : right.text}
                        </td>
                      </tr>,
                    ];
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      ) : (
        sortedTags.map(tag => (
          <section key={tag || '__untagged__'}>
            <h3 className="text-sm font-bold text-color-text px-2 py-1 bg-grey-1 border-b border-grey-3 sticky top-0">
              {tag || 'Untagged'}
            </h3>
            <ul className="flex flex-col mt-2">
              {(searchCategoryIds.length > 1
                ? [...tagMap.get(tag)!].sort((a, b) => {
                    const aSeq = hasSequence(rawSpanMap.get(a.id) ?? [], searchCategoryIds) ? 0 : 1;
                    const bSeq = hasSequence(rawSpanMap.get(b.id) ?? [], searchCategoryIds) ? 0 : 1;
                    return aSeq - bSeq;
                  })
                : tagMap.get(tag)!
              ).map(ann => {
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
                        {labeledSpans.length > 0 ? (
                          <HighlightedSentence
                            original={excerptText}
                            spans={labeledSpans}
                            labelColors={labelIndex.labelColors}
                            labelNames={labelIndex.labelNames}
                            activeLabels={activeLabels}
                            mode={renderMode}
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
        ))
      )}
    </div>
  );
}

export default withServices(GroupAnnotationsTab, ['tagInventoryGroupSync']);
