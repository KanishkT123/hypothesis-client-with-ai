import {
  Button,
  CancelIcon,
  Card,
  CardContent,
  confirm,
  HideIcon,
  Input,
  RedoIcon,
  ShowIcon,
  TrashIcon,
} from '@hypothesis/frontend-shared';
import classnames from 'classnames';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import {
  hexColorInputToRgba,
  highlightRgbaFromString,
  rgbaStringToHexColorInput,
  TAG_HIGHLIGHT_ALPHA,
} from '../../../shared/tag-color-from-string';
import {
  buildClaudeAISearchUserMessage,
  collectNegativeExamplesFromAnnotations,
  collectPositiveExamplesFromAnnotations,
  countAiSearchQuotesSkippedAsDuplicates,
  countAISearchRowPendingAnnotations,
  countAISearchRowTotalAnnotations,
  deleteAllActionForAISearchRowMatch,
  expectedTagsForStrictAISearchPending,
  filterAiSearchQuotesAgainstExisting,
  listSavedAnnotationsMatchingAISearchRow,
  listStrictAISearchRowPendingAnnotations,
  tagsAfterRemovingAISearchRowSchemaTag,
} from '../../helpers/claude-ai-search-user-message';
import { quote as annotationQuote } from '../../helpers/annotation-metadata';
import { mergeVisibleAISearchTagHighlightPalette } from '../../helpers/ai-search-tag-palette';
import {
  isAISearchRowVisibleInScope,
  sortAISearchRows,
} from '../../helpers/ai-search-group-history';
import { PUBLIC_GROUP_ID } from '../../helpers/groups';
import { formatSidebarTagFilter } from '../../helpers/filter-query-for-tag';
import { sharedPermissions } from '../../helpers/permissions';
import { withServices } from '../../service-context';
import type { AISearchGroupHistorySyncService } from '../../services/ai-search-group-history-sync';
import type { ExperimentLogService } from '../../services/experiment-log';
import type { SavedAnnotation } from '../../../types/api';
import type { AnnotationsService } from '../../services/annotations';
import type { APIService } from '../../services/api';
import type { FrameSyncService } from '../../services/frame-sync';
// import type { ReductoService } from '../../services/reducto';
import type {
  ClaudeSearchResult,
  ClaudeService,
} from '../../services/claude';
import type { ToastMessengerService } from '../../services/toast-messenger';
import { useSidebarStore } from '../../store';
import type { AISearchRow } from '../../store/modules/sidebar-panels';
import SidebarPanel from '../SidebarPanel';
import { abortAllClaudeRuns, registerClaudeRun } from './ai-search-claude-runs';
import SearchField from './SearchField';

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** At most one progress toast per second; always emit first and last index. */
function emitThrottledProgress(
  toastMessenger: ToastMessengerService,
  prefix: string,
  index: number,
  total: number,
  lastEmitMs: { current: number },
) {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const now = Date.now();
  if (isFirst || isLast || now - lastEmitMs.current >= 5000) {
    lastEmitMs.current = now;
    toastMessenger.notice(`${prefix} ${index + 1}/${total}`);
  }
}

function formatClaudeWaitElapsed(anchorMs: number, nowMs: number): string {
  const elapsedSec = Math.max(0, Math.floor((nowMs - anchorMs) / 1000));
  const m = Math.floor(elapsedSec / 60);
  const s = elapsedSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const aiSearchHistoryActionButtonClass =
  'p-1 rounded text-grey-6 hover:text-color-text hover:bg-grey-2 transition-colors duration-200 focus-visible-ring';

/** Native title / aria-label for the history-table rerun (redo) control */
const aiSearchRerunButtonHelpText =
  'Delete all pending suggestions for this tag and query, then re-run the AI search using updated positive and negative annotation examples from all tags on this document.';

type AISearchPanelProps = {
  annotationsService: AnnotationsService;
  experimentLog: ExperimentLogService;
  frameSync: FrameSyncService;
  // reducto: ReductoService;
  claude: ClaudeService;
  api: APIService;
  toastMessenger: ToastMessengerService;
  aiSearchGroupHistorySync: AISearchGroupHistorySyncService;
};

function AISearchPanel({
  annotationsService,
  experimentLog,
  frameSync,
  // reducto,
  claude,
  api,
  toastMessenger,
  aiSearchGroupHistorySync,
}: AISearchPanelProps) {
  const store = useSidebarStore();
  /** AI prompt text only; not the global sidebar filter query (see setFilterQuery). */
  const aiSearchFieldQuery = store.aiSearchPanelQueryInput();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [runAISearchInFlight, setRunAISearchInFlight] = useState(false);
  // const [reductoAPIKey, setReductoAPIKey] = useState('');
  const [claudeAPIKey, setClaudeAPIKey] = useState('');
  const schemaTag = store.aiSearchPanelSchemaTagInput();
  const annotateManually = store.aiSearchPanelAnnotateManually();
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);
  const [rerunningRowId, setRerunningRowId] = useState<string | null>(null);
  const rerunLockRef = useRef(false);
  /** Wall time when the current Claude API request started; drives panel timer + Stop. */
  const [claudeRunStartedAt, setClaudeRunStartedAt] = useState<number | null>(
    null,
  );
  const [claudeTimerTick, setClaudeTimerTick] = useState(0);
  /** When true, rows marked `hidden` are included in the history table. */
  const [showHiddenRows, setShowHiddenRows] = useState(true);
  /** True while a user-triggered "Refresh group tags" sync is in flight. */
  const [refreshingGroupTags, setRefreshingGroupTags] = useState(false);

  const aiRows = store.aiSearchRows();
  const focusedGroupId = store.focusedGroupId();
  const publicDocumentScope = store.aiSearchPublicDocumentScope();
  const savedAnnotations = store.savedAnnotations();
  const schemaTagColors = store.aiSearchSchemaTagColors();
  const documentURL = claude.firstPDFURI(store.searchUris());

  const globalRowLock =
    runAISearchInFlight ||
    rerunningRowId !== null ||
    deletingRowId !== null;
  const canAnnotateManually = schemaTag.trim().length > 0;

  const publicDocumentDescriptorKeys = useMemo(
    () =>
      publicDocumentScope
        ? new Set(publicDocumentScope.visibleDescriptorKeys)
        : null,
    [publicDocumentScope],
  );
  /** Rows visible in the focused group (before the hidden-row toggle). */
  const scopedRows = useMemo(() => {
    if (!focusedGroupId) {
      return [];
    }
    return aiRows.filter(row =>
      isAISearchRowVisibleInScope(row, {
        focusedGroupId,
        publicDocumentDescriptorKeys,
      }),
    );
  }, [aiRows, focusedGroupId, publicDocumentDescriptorKeys]);
  const displayRows = useMemo(
    () =>
      sortAISearchRows(
        showHiddenRows ? scopedRows : scopedRows.filter(r => !r.hidden),
      ),
    [scopedRows, showHiddenRows],
  );
  const hasAnyHiddenRows = useMemo(
    () => scopedRows.some(r => r.hidden === true),
    [scopedRows],
  );
  const isPublicGroup = focusedGroupId === PUBLIC_GROUP_ID;
  /** Private groups can always refresh, even before any rows exist. */
  const canRefreshGroupTags = !isPublicGroup && !!focusedGroupId;
  /**
   * Show the history section when there are rows to display or when the user
   * can refresh group tags (so the Refresh control is reachable for an
   * as-yet-empty private group).
   */
  const showHistorySection = scopedRows.length > 0 || canRefreshGroupTags;
  const emptyHistoryMessage =
    scopedRows.length === 0
      ? 'No AI search tags found in this group yet.'
      : 'All rows are hidden.';
  const hiddenRowsToggleDisabled = !hasAnyHiddenRows;
  const hiddenRowsToggleTitle = hiddenRowsToggleDisabled
    ? 'No un-rendered rows'
    : showHiddenRows
      ? 'Hide un-rendered rows from this list'
      : 'Show un-rendered rows in this list';

  useEffect(() => {
    if (claudeRunStartedAt === null) {
      return undefined;
    }
    const id = window.setInterval(() => setClaudeTimerTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [claudeRunStartedAt]);

  const claudeWaitElapsedLabel = useMemo(() => {
    if (claudeRunStartedAt === null) {
      return '';
    }
    return formatClaudeWaitElapsed(claudeRunStartedAt, Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- claudeTimerTick advances the clock display
  }, [claudeRunStartedAt, claudeTimerTick]);

  const closeAISearchPanel = () => {
    store.closeSidebarPanel('aiSearchAnnotations');
  };
  const clearQueryInput = () => {
    store.setAISearchPanelQueryInput(null);
  };

  /**
   * Re-fetch all annotations in the focused (private) group and re-derive
   * history rows. Disabled for Public (document-scoped) and while in flight.
   */
  const onRefreshGroupTags = async () => {
    if (isPublicGroup || refreshingGroupTags) {
      return;
    }
    setRefreshingGroupTags(true);
    try {
      await aiSearchGroupHistorySync.syncGroupHistory({ mode: 'auto' });
    } finally {
      setRefreshingGroupTags(false);
    }
  };

  async function runAISearch(
    schemaTagForRow: string,
    query: string,
    options?: { replaceRowId?: string },
  ) {
    setRunAISearchInFlight(true);
    try {
      const userid = store.profile().userid;
      const groupId = store.focusedGroupId();

      if (!userid || !groupId || !documentURL) {
        toastMessenger.error('Missing user, group, or PDF URL');
        return;
      }

      const positiveExamples = await collectPositiveExamplesFromAnnotations(
        store.savedAnnotations(),
        documentURL,
        annotationsService,
      );
      // Negatives come from `{schemaTag}-neg-example` annotations on the
      // current document (document-scoped until commit 5 widens to the group).
      const negativeExamples = collectNegativeExamplesFromAnnotations(
        store.savedAnnotations(),
        documentURL,
      );
      const tagTrim = schemaTagForRow.trim();
      const fullUserMessage = buildClaudeAISearchUserMessage({
        positiveExamples,
        schemaTag: tagTrim,
        searchQuery: query,
        negativeExamples,
      });

      const { signal, finish } = registerClaudeRun();
      setClaudeRunStartedAt(Date.now());
      let claudeResult: ClaudeSearchResult;
      try {
        toastMessenger.notice('Waiting on model');
        // eslint-disable-next-line new-cap -- AISearchDocument is a service method, not a constructor
        claudeResult = await claude.AISearchDocument({
          query: fullUserMessage,
          candidateURIs: store.searchUris(),
          apiKey: claudeAPIKey,
          signal,
        });
      } finally {
        finish();
        setClaudeRunStartedAt(null);
      }

      if (signal.aborted) {
        return;
      }

      const rawQuotes = ((claudeResult.answer as any).result?.[0]?.quotes ??
        []) as Array<{ text?: string }>;
      const quotes = filterAiSearchQuotesAgainstExisting(
        rawQuotes,
        store.savedAnnotations(),
        documentURL,
        tagTrim,
      );
      const skippedDuplicate = countAiSearchQuotesSkippedAsDuplicates(
        rawQuotes,
        quotes,
      );

      const tags = expectedTagsForStrictAISearchPending(tagTrim);

      toastMessenger.notice('Creating annotations…');

      const created = [];
      for (const quote of quotes) {
        if (!quote.text?.trim()) {
          continue;
        }
        const payload = {
          group: groupId,
          uri: documentURL,
          target: [
            {
              source: documentURL,
              selector: [
                { type: 'TextQuoteSelector' as const, exact: quote.text },
              ],
            },
          ],
          text: query,
          tags,
          permissions: sharedPermissions(userid, groupId),
        };
        const ann = await api.annotation.create({}, payload);
        created.push(ann);
      }
      if (created.length) {
        store.addAnnotations(created);
      }

      const newIds = created
        .map(a => a.id)
        .filter((id): id is string => typeof id === 'string');

      const rowId = options?.replaceRowId ?? crypto.randomUUID();

      if (options?.replaceRowId) {
        store.setAISearchRowAnnotationIds(options.replaceRowId, newIds);
        store.setAISearchRowHidden(options.replaceRowId, false);
      } else {
        const row: AISearchRow = {
          id: rowId,
          groupId,
          schemaTag: schemaTagForRow,
          query,
          annotationIds: newIds,
        };
        store.addAISearchRow(row);
      }

      experimentLog.logSearch({
        query,
        schemaTag: schemaTagForRow,
        searchRowId: rowId,
        documentUri: documentURL,
        annotationIdsCreated: newIds,
        quoteTexts: created.map(a => annotationQuote(a) ?? ''),
      });

      let successMsg = `Created ${created.length} annotation(s) from AI results.`;
      if (skippedDuplicate > 0) {
        successMsg += ` Skipped ${skippedDuplicate} already covered.`;
      }
      toastMessenger.success(successMsg);
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      console.error('Error creating annotations from AI results:', error);
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to create annotations from AI results.';
      toastMessenger.error(message);
    } finally {
      setRunAISearchInFlight(false);
    }
  }

  async function onAISearch(query: string) {
    const tagKey = schemaTag.trim();
    const queryKey = query.trim();
    const matchingRow = aiRows.find(
      r => r.schemaTag.trim() === tagKey && r.query.trim() === queryKey,
    );
    if (matchingRow) {
      await onRerunRow(matchingRow);
    } else {
      await runAISearch(schemaTag, query);
    }
  }

  async function onRerunRow(row: AISearchRow) {
    if (rerunLockRef.current) {
      return;
    }
    rerunLockRef.current = true;
    try {
      const userid = store.profile().userid;
      const groupId = store.focusedGroupId();
      const documentURL = claude.firstPDFURI(store.searchUris());

      if (!userid || !groupId || !documentURL) {
        toastMessenger.error('Missing user, group, or PDF URL');
        return;
      }

      setRerunningRowId(row.id);
      try {
        store.mergeAISearchRowsWithSameTagQuery(row.id);

        const pending = listStrictAISearchRowPendingAnnotations(
          store.savedAnnotations() as SavedAnnotation[],
          documentURL,
          row.schemaTag,
          row.query,
        );

        const deletedIds: string[] = [];
        const progressEmit = { current: 0 };
        for (let i = 0; i < pending.length; i++) {
          const ann = pending[i];
          emitThrottledProgress(
            toastMessenger,
            'Deleting pending…',
            i,
            pending.length,
            progressEmit,
          );
          if (ann.id) {
            await annotationsService.delete(ann);
            deletedIds.push(ann.id);
          }
        }
        if (deletedIds.length) {
          store.removeAnnotationIdsFromAISearchRows(deletedIds);
        }

        experimentLog.logRerunSearch({
          searchRowId: row.id,
          query: row.query,
          schemaTag: row.schemaTag,
          documentUri: documentURL,
        });

        await runAISearch(row.schemaTag, row.query, { replaceRowId: row.id });
      } catch (err) {
        console.error(err);
        toastMessenger.error('Failed to rerun AI search.');
      } finally {
        setRerunningRowId(null);
      }
    } finally {
      rerunLockRef.current = false;
    }
  }

  async function onDeletePending(row: AISearchRow) {
    if (!documentURL) {
      toastMessenger.error('Missing PDF URL');
      return;
    }

    setDeletingRowId(row.id);
    try {
      const pending = listStrictAISearchRowPendingAnnotations(
        savedAnnotations as SavedAnnotation[],
        documentURL,
        row.schemaTag,
        row.query,
      );
      const deletedIds: string[] = [];
      const progressEmit = { current: 0 };
      for (let i = 0; i < pending.length; i++) {
        const ann = pending[i];
        emitThrottledProgress(
          toastMessenger,
          'Deleting pending…',
          i,
          pending.length,
          progressEmit,
        );
        if (ann.id) {
          await annotationsService.delete(ann as SavedAnnotation);
          deletedIds.push(ann.id);
        }
      }
      if (deletedIds.length) {
        store.removeAnnotationIdsFromAISearchRows(deletedIds);
        experimentLog.logDeletePending({
          searchRowId: row.id,
          query: row.query,
          schemaTag: row.schemaTag,
          documentUri: documentURL,
        });
        toastMessenger.success(
          `Deleted ${deletedIds.length} pending annotation(s).`,
          { visuallyHidden: true },
        );
      }
    } catch (err) {
      console.error(err);
      toastMessenger.error('Failed to delete pending annotations.');
    } finally {
      setDeletingRowId(null);
    }
  }

  async function onDeleteAll(row: AISearchRow) {
    if (!documentURL) {
      toastMessenger.error('Missing PDF URL');
      return;
    }

    const confirmed = await confirm({
      title: 'Delete all for this tag and query?',
      message:
        'This removes this row’s schema tag from annotations that still have other tags, or fully deletes annotations that only have this tag (plus ai-pending / ai-user-approved). For rows with no schema tag, matching annotations are deleted entirely. This affects pending, user-approved, and other matching annotations on this document.',
      confirmAction: 'Delete all',
    });
    if (!confirmed) {
      return;
    }

    setDeletingRowId(row.id);
    try {
      const matches = listSavedAnnotationsMatchingAISearchRow(
        savedAnnotations as SavedAnnotation[],
        documentURL,
        row.schemaTag,
        row.query,
      );
      const schemaTrim = row.schemaTag.trim();
      const touchedIds: string[] = [];
      let skippedOrFailedCount = 0;

      for (const ann of matches) {
        if (!ann.id) {
          continue;
        }
        const action = deleteAllActionForAISearchRowMatch(ann, schemaTrim);
        try {
          if (action === 'removeRowTag') {
            const newTags = tagsAfterRemovingAISearchRowSchemaTag(
              ann.tags,
              schemaTrim,
            );
            let updated = await api.annotation.update(
              { id: ann.id },
              { tags: newTags },
            );
            for (const [key, value] of Object.entries(ann)) {
              if (key.startsWith('$')) {
                updated = { ...updated, [key]: value };
              }
            }
            store.addAnnotations([updated]);
            touchedIds.push(ann.id);
          } else {
            await annotationsService.delete(ann as SavedAnnotation);
            touchedIds.push(ann.id);
          }
        } catch (err) {
          skippedOrFailedCount += 1;
          console.error('Failed to apply delete-all action for annotation:', err);
        }
      }

      if (touchedIds.length) {
        store.removeAnnotationIdsFromAISearchRows(touchedIds);
      }
      store.removeAISearchRow(row.id);

      experimentLog.logDeleteAll({
        searchRowId: row.id,
        query: row.query,
        schemaTag: row.schemaTag,
        documentUri: documentURL,
      });

      if (skippedOrFailedCount > 0) {
        toastMessenger.notice(
          `Removed row. Skipped ${skippedOrFailedCount} matching annotation(s) that could not be modified.`,
        );
      } else {
        toastMessenger.success('AI search row removed.');
      }
    } catch (err) {
      console.error(err);
      toastMessenger.error('Failed to complete delete all.');
    } finally {
      setDeletingRowId(null);
    }
  }

  function colorForRow(row: AISearchRow): string {
    const tag = row.schemaTag.trim();
    if (!tag) {
      return highlightRgbaFromString('');
    }
    return (
      schemaTagColors[tag] ?? highlightRgbaFromString(tag)
    );
  }

  return (
    <SidebarPanel
      panelName="aiSearchAnnotations"
      label="AI search panel"
      initialFocus={inputRef}
      onActiveChanged={active => {
        if (!active) {
          store.setFilterQuery(null);
          store.setAISearchPanelQueryInput(null);
        } else {
          frameSync.setTagHighlightPalette(
            mergeVisibleAISearchTagHighlightPalette(
              store.aiSearchRows(),
              store.aiSearchSchemaTagColors(),
            ),
          );
        }
      }}
    >
      <Card>
        <CardContent>
          <div className="flex flex-col gap-y-3">
            <Input
              aria-label="Claude API key"
              classes="text-base touch:text-touch-base"
              data-testid="claude-api-key-input"
              dir="auto"
              name="claude-api-key"
              placeholder="CLAUDE_API_KEY"
              type="password"
              value={claudeAPIKey}
              onInput={(e: Event) =>
                setClaudeAPIKey((e.target as HTMLInputElement).value)
              }
            />
            <Input
              aria-label="schema tag"
              classes="text-base touch:text-touch-base"
              data-testid="schema-tag-input"
              dir="auto"
              name="schema-tag"
              placeholder="Tag"
              type="text"
              value={schemaTag}
              onInput={(e: Event) => {
                store.setAISearchPanelSchemaTagInput(
                  (e.target as HTMLInputElement).value,
                );
              }}
            />
            <SearchField
              inputRef={inputRef}
              classes="grow"
              fullWidthSubmitLabel="Ask AI for Annotations"
              fullWidthSubmitLeading={
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  data-pressed={annotateManually ? 'true' : 'false'}
                  data-testid="ai-search-manual-annotate-toggle"
                  disabled={!canAnnotateManually}
                  title={
                    canAnnotateManually
                      ? annotateManually
                        ? 'Disable manual annotation tagging'
                        : 'Enable manual annotation tagging'
                      : 'Set a schema tag to enable manual annotation tagging'
                  }
                  classes={classnames(
                    'shrink-0',
                    annotateManually && 'bg-grey-3 text-color-text',
                  )}
                  onClick={() => {
                    store.setAISearchPanelAnnotateManually(!annotateManually);
                  }}
                >
                  Annotate Manually
                </Button>
              }
              fullWidthSubmitTrailing={
                <>
                  <span
                    className="min-w-[2.5rem] text-right tabular-nums text-xs text-color-text-light"
                    aria-live={claudeRunStartedAt !== null ? 'polite' : 'off'}
                    aria-atomic="true"
                  >
                    {claudeRunStartedAt !== null
                      ? claudeWaitElapsedLabel
                      : '0:00'}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    data-testid="ai-search-stop-button"
                    disabled={claudeRunStartedAt === null}
                    title={
                      claudeRunStartedAt === null
                        ? 'No AI search in progress'
                        : 'Stop AI search'
                    }
                    classes="shrink-0"
                    onClick={() => abortAllClaudeRuns()}
                  >
                    Stop
                  </Button>
                </>
              }
              multiline
              allowSubmitWithJustTag={schemaTag.trim().length > 0}
              placeholder="ask AI to highlight…"
              rows={4}
              disabled={globalRowLock}
              query={aiSearchFieldQuery}
              onQueryChange={value => store.setAISearchPanelQueryInput(value)}
              onClearSearch={clearQueryInput}
              onSearch={onAISearch}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  closeAISearchPanel();
                }
              }}
            />
            {showHistorySection && (
              <div className="flex flex-col gap-y-1">
                {displayRows.length === 0 ? (
                  <p className="text-color-text-light text-xs leading-snug m-0 py-1">
                    {emptyHistoryMessage}
                  </p>
                ) : (
                <table className="w-full table-auto border-collapse text-left text-sm text-color-text">
                  <colgroup>
                    <col className="w-min" />
                    {/* min: short tags fit on one line; max: do not outgrow the query column */}
                    <col className="min-w-[7rem] max-w-[11rem]" />
                    <col className="w-full min-w-0" />
                    <col className="w-min" />
                    <col className="w-min" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-grey-3 text-color-text-light">
                      <th className="py-1 pr-2 text-sm font-normal" scope="col">
                        <span className="sr-only">Color</span>
                      </th>
                      <th className="py-1 pr-2 text-sm font-normal" scope="col">
                        Tag
                      </th>
                      <th className="py-1 pr-2 text-sm font-normal" scope="col">
                        Query
                      </th>
                      <th
                        className="py-1 pr-2 text-right text-sm font-normal tabular-nums"
                        scope="col"
                      >
                        <span className="sr-only">
                          Pending and total matching annotations for this tag and
                          query
                        </span>
                      </th>
                      <th
                        className="py-1 text-center text-sm font-normal"
                        scope="col"
                      >
                        <span className="sr-only">
                          Rerun AI search, delete pending, delete all
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map(row => {
                      const tagKey = row.schemaTag.trim();
                      const rgba = colorForRow(row);
                      const hex = rgbaStringToHexColorInput(rgba);
                      const pendingCount = documentURL
                        ? countAISearchRowPendingAnnotations(
                            savedAnnotations,
                            documentURL,
                            row.schemaTag,
                            row.query,
                          )
                        : 0;
                      const totalCount = documentURL
                        ? countAISearchRowTotalAnnotations(
                            savedAnnotations,
                            documentURL,
                            row.schemaTag,
                            row.query,
                          )
                        : 0;
                      const rerunDisabled =
                        globalRowLock || !documentURL;
                      const deletePendingDisabled =
                        globalRowLock ||
                        !documentURL ||
                        pendingCount === 0;
                      const deleteAllDisabled =
                        globalRowLock || !documentURL;
                      return (
                        <tr
                          key={row.id}
                          className={classnames(
                            'border-b border-grey-2 last:border-0',
                            row.hidden && 'opacity-70',
                          )}
                        >
                          <td className="py-1 pr-2 align-middle whitespace-nowrap w-min">
                            <div className="flex flex-col items-center gap-0.5">
                              <input
                                aria-label={`Highlight color for tag ${tagKey || '(empty)'}`}
                                className="h-8 w-10 cursor-pointer rounded border border-grey-3 bg-transparent p-0"
                                disabled={!tagKey}
                                title={
                                  tagKey
                                    ? undefined
                                    : 'Set a schema tag to customize color'
                                }
                                type="color"
                                value={hex}
                                onInput={(e: Event) => {
                                  if (!tagKey) {
                                    return;
                                  }
                                  const v = (e.target as HTMLInputElement)
                                    .value;
                                  store.setAISearchSchemaTagColor(
                                    tagKey,
                                    hexColorInputToRgba(v, TAG_HIGHLIGHT_ALPHA),
                                  );
                                }}
                              />
                              <button
                                type="button"
                                className={classnames(
                                  aiSearchHistoryActionButtonClass,
                                  'shrink-0',
                                )}
                                title={
                                  row.hidden
                                    ? 'Render this highlight in the PDF'
                                    : 'Hide this highlight from the PDF'
                                }
                                aria-label={
                                  row.hidden
                                    ? 'Render this highlight in the PDF'
                                    : 'Hide this highlight from the PDF'
                                }
                                onClick={() =>
                                  store.setAISearchRowHidden(
                                    row.id,
                                    !row.hidden,
                                  )
                                }
                              >
                                {row.hidden ? (
                                  <ShowIcon className="w-em h-em" />
                                ) : (
                                  <HideIcon className="w-em h-em" />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="py-1 pr-2 align-middle break-words text-xs leading-snug">
                            {tagKey ? (
                              <button
                                type="button"
                                className={classnames(
                                  'm-0 w-full max-w-full min-w-0 border-0 bg-transparent p-0',
                                  'text-left font-inherit text-xs leading-snug text-color-text',
                                  'cursor-pointer break-words underline underline-offset-2',
                                  'hover:text-color-text',
                                  'rounded focus-visible-ring',
                                )}
                                title={`Show annotations with tag: ${tagKey}`}
                                aria-label={`Filter sidebar to annotations tagged ${tagKey}`}
                                onClick={() => {
                                  store.setFilterQuery(
                                    formatSidebarTagFilter(tagKey),
                                  );
                                }}
                              >
                                {row.schemaTag}
                              </button>
                            ) : (
                              <span className="text-color-text-light">—</span>
                            )}
                          </td>
                          <td className="py-1 pr-2 align-middle break-words text-xs leading-snug">
                            {row.query.trim() ? (
                              row.query
                            ) : (
                              <span className="text-color-text-light">
                                No query - matches this tag across the document
                              </span>
                            )}
                          </td>
                          <td className="w-min py-1 pr-2 text-right align-middle tabular-nums whitespace-nowrap">
                            <span
                              title="Strict AI-pending annotations for this tag and query on this document"
                              className="cursor-help tabular-nums"
                              aria-label={`${pendingCount} pending`}
                            >
                              {pendingCount}
                            </span>
                            <span className="text-color-text-light" aria-hidden="true">
                              {' '}
                              |{' '}
                            </span>
                            <span
                              title="Total matching annotations on this document: manual, accepted suggestions, and pending suggestions"
                              className="cursor-help tabular-nums"
                              aria-label={`${totalCount} total`}
                            >
                              {totalCount}
                            </span>
                          </td>
                          <td className="w-min py-1 align-middle whitespace-nowrap">
                            <div className="flex w-min flex-col items-center gap-0.5">
                              <button
                                type="button"
                                aria-disabled={rerunDisabled}
                                tabIndex={rerunDisabled ? -1 : undefined}
                                className={classnames(
                                  aiSearchHistoryActionButtonClass,
                                  rerunDisabled && 'opacity-50 cursor-not-allowed',
                                )}
                                title={aiSearchRerunButtonHelpText}
                                aria-label={aiSearchRerunButtonHelpText}
                                onClick={e => {
                                  if (rerunDisabled) {
                                    e.preventDefault();
                                    return;
                                  }
                                  onRerunRow(row);
                                }}
                              >
                                <RedoIcon className="w-em h-em" />
                              </button>
                              <button
                                type="button"
                                aria-disabled={deletePendingDisabled}
                                tabIndex={deletePendingDisabled ? -1 : undefined}
                                className={classnames(
                                  aiSearchHistoryActionButtonClass,
                                  deletePendingDisabled &&
                                    'opacity-50 cursor-not-allowed',
                                )}
                                title="Delete pending AI annotations for this tag and query"
                                aria-label="Delete pending"
                                onClick={e => {
                                  if (deletePendingDisabled) {
                                    e.preventDefault();
                                    return;
                                  }
                                  onDeletePending(row);
                                }}
                              >
                                <CancelIcon className="w-em h-em" />
                              </button>
                              <button
                                type="button"
                                aria-disabled={deleteAllDisabled}
                                tabIndex={deleteAllDisabled ? -1 : undefined}
                                className={classnames(
                                  aiSearchHistoryActionButtonClass,
                                  deleteAllDisabled &&
                                    'opacity-50 cursor-not-allowed',
                                )}
                                title="Delete all matching annotations for this tag and query"
                                aria-label="Delete all"
                                onClick={e => {
                                  if (deleteAllDisabled) {
                                    e.preventDefault();
                                    return;
                                  }
                                  onDeleteAll(row);
                                }}
                              >
                                <TrashIcon className="w-em h-em" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                )}
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <p className="text-color-text-light text-xs leading-snug m-0 grow min-w-[12rem]">
                    Highlight color is per tag (rows sharing a tag share the
                    color).
                  </p>
                  <div className="flex shrink-0 items-center gap-x-2">
                    <button
                      type="button"
                      data-testid="ai-search-refresh-group-tags"
                      disabled={isPublicGroup || refreshingGroupTags}
                      aria-disabled={isPublicGroup || refreshingGroupTags}
                      title={
                        isPublicGroup
                          ? 'Group tag refresh is unavailable in the public group'
                          : 'Re-fetch tags from all annotations in this group'
                      }
                      aria-label="Refresh group tags"
                      className={classnames(
                        'shrink-0 text-xs rounded px-2 py-1 border border-grey-3',
                        'text-color-text hover:bg-grey-2 transition-colors duration-200 focus-visible-ring',
                        (isPublicGroup || refreshingGroupTags) &&
                          'opacity-50 cursor-not-allowed',
                      )}
                      onClick={() => {
                        void onRefreshGroupTags();
                      }}
                    >
                      {refreshingGroupTags
                        ? 'Refreshing group tags…'
                        : 'Refresh group tags'}
                    </button>
                    <button
                      type="button"
                      disabled={hiddenRowsToggleDisabled}
                      title={hiddenRowsToggleTitle}
                      aria-label={hiddenRowsToggleTitle}
                      className={classnames(
                        'shrink-0 text-xs rounded px-2 py-1 border border-grey-3',
                        'text-color-text hover:bg-grey-2 transition-colors duration-200 focus-visible-ring',
                        hiddenRowsToggleDisabled &&
                          'opacity-50 cursor-not-allowed',
                      )}
                      onClick={() => {
                        if (hiddenRowsToggleDisabled) {
                          return;
                        }
                        setShowHiddenRows(v => !v);
                      }}
                    >
                      {showHiddenRows
                        ? 'Hide un-rendered rows'
                        : 'Show un-rendered rows'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </SidebarPanel>
  );
}

export default withServices(AISearchPanel, [
  'annotationsService',
  'experimentLog',
  'frameSync',
  // 'reducto',
  'claude',
  'api',
  'toastMessenger',
  'aiSearchGroupHistorySync',
]);
