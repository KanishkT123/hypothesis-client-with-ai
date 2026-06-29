import { Card, CardContent } from '@hypothesis/frontend-shared';
import classnames from 'classnames';
import { useCallback, useMemo, useState } from 'preact/hooks';

import { highlightRgbaFromString } from '../../../shared/tag-color-from-string';
import {
  buildNodeLinkGraph,
  type NodeLinkQuoteNode,
  type NodeLinkTagNode,
} from '../../helpers/node-link-graph';
import { withServices } from '../../service-context';
import type { FrameSyncService } from '../../services/frame-sync';
import { useSidebarStore } from '../../store';
import SidebarPanel from '../SidebarPanel';

type NodePosition = {
  x: number;
  y: number;
};

type NodeLinkPanelProps = {
  frameSync: FrameSyncService;
};

const GRAPH_WIDTH = 680;
const GRAPH_TOP_PADDING = 48;
const GRAPH_BOTTOM_PADDING = 52;
const MIN_GRAPH_HEIGHT = 320;
const TAG_X = 92;
const QUOTE_X = 426;
const QUOTE_WIDTH = 220;
const QUOTE_HEIGHT = 58;

function compressedText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function wrappedLabel(
  text: string,
  maxCharsPerLine: number,
  maxLines: number,
): string[] {
  const words = compressedText(text).split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxCharsPerLine) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(word.slice(0, maxCharsPerLine));
      current = word.slice(maxCharsPerLine);
    }

    if (lines.length === maxLines) {
      break;
    }
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  const didTruncate =
    lines.join(' ').length < compressedText(text).length ||
    lines.some(line => line.length > maxCharsPerLine);
  if (didTruncate && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] =
      last.length > maxCharsPerLine - 3
        ? `${last.slice(0, maxCharsPerLine - 3)}...`
        : `${last}...`;
  }

  return lines.length ? lines : [''];
}

function yForIndex(index: number, count: number, height: number) {
  if (count <= 1) {
    return height / 2;
  }
  const available = height - GRAPH_TOP_PADDING - GRAPH_BOTTOM_PADDING;
  return GRAPH_TOP_PADDING + (available * index) / (count - 1);
}

function tagNodeRadius(node: NodeLinkTagNode) {
  return Math.min(28, 13 + Math.sqrt(node.annotationIds.length) * 4);
}

function tagColor(tag: string, palette: Record<string, string>) {
  return palette[tag] ?? highlightRgbaFromString(tag);
}

function pathBetween(source: NodePosition, target: NodePosition) {
  const midX = source.x + (target.x - source.x) * 0.52;
  return `M ${source.x} ${source.y} C ${midX} ${source.y}, ${midX} ${target.y}, ${target.x} ${target.y}`;
}

export function NodeLinkPanel({ frameSync }: NodeLinkPanelProps) {
  const store = useSidebarStore();
  const annotations = store.savedAnnotations();
  const currentUris = store.searchUris();
  const palette = store.getState().sidebarPanels.tagInventory.schemaTagColors;
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const graph = useMemo(
    () => buildNodeLinkGraph(annotations, { uris: currentUris }),
    [annotations, currentUris],
  );

  const annotationsById = useMemo(() => {
    return new Map(annotations.map(annotation => [annotation.id, annotation]));
  }, [annotations]);

  const visibleEdges = useMemo(
    () =>
      selectedTag
        ? graph.edges.filter(edge => edge.tag === selectedTag)
        : graph.edges,
    [graph.edges, selectedTag],
  );

  const visibleQuoteIds = useMemo(
    () => new Set(visibleEdges.map(edge => edge.target)),
    [visibleEdges],
  );

  const visibleQuoteNodes = useMemo(
    () =>
      selectedTag
        ? graph.quoteNodes.filter(node => visibleQuoteIds.has(node.id))
        : graph.quoteNodes,
    [graph.quoteNodes, selectedTag, visibleQuoteIds],
  );

  const graphHeight = Math.max(
    MIN_GRAPH_HEIGHT,
    Math.max(graph.tagNodes.length, visibleQuoteNodes.length) * 72 +
      GRAPH_TOP_PADDING +
      GRAPH_BOTTOM_PADDING,
  );

  const tagPositions = useMemo(() => {
    return new Map(
      graph.tagNodes.map((node, index) => [
        node.id,
        {
          x: TAG_X,
          y: yForIndex(index, graph.tagNodes.length, graphHeight),
        },
      ]),
    );
  }, [graph.tagNodes, graphHeight]);

  const quotePositions = useMemo(() => {
    return new Map(
      visibleQuoteNodes.map((node, index) => [
        node.id,
        {
          x: QUOTE_X,
          y: yForIndex(index, visibleQuoteNodes.length, graphHeight),
        },
      ]),
    );
  }, [graphHeight, visibleQuoteNodes]);

  const focusAnnotation = useCallback(
    (node: NodeLinkQuoteNode) => {
      const annotation = annotationsById.get(node.annotationId);
      if (annotation) {
        frameSync.scrollToAnnotation(annotation);
      }
    },
    [annotationsById, frameSync],
  );

  const hoverAnnotation = useCallback(
    (node: NodeLinkQuoteNode | null) => {
      const annotation = node ? annotationsById.get(node.annotationId) : null;
      frameSync.hoverAnnotation(annotation ?? null);
    },
    [annotationsById, frameSync],
  );

  const toggleTag = useCallback((tag: string) => {
    setSelectedTag(current => (current === tag ? null : tag));
  }, []);

  const clearHover = useCallback(() => {
    setHoveredNodeId(null);
    hoverAnnotation(null);
  }, [hoverAnnotation]);

  const isEmpty = graph.tagNodes.length === 0 || graph.quoteNodes.length === 0;

  return (
    <SidebarPanel
      panelName="nodeLinkAnnotations"
      label="Node-link panel"
      onActiveChanged={active => {
        if (!active) {
          setSelectedTag(null);
          clearHover();
        }
      }}
    >
      <Card>
        <CardContent>
          <div className="flex items-center justify-between gap-x-3">
            <div>
              <h2 className="text-lg font-semibold leading-tight">Node Link</h2>
              <div className="text-color-text-light text-sm">
                {graph.tagNodes.length} tags / {graph.quoteNodes.length}{' '}
                passages
              </div>
            </div>
            {selectedTag && (
              <button
                className="text-sm text-brand hover:underline focus-visible-ring rounded"
                onClick={() => setSelectedTag(null)}
                type="button"
              >
                Clear
              </button>
            )}
          </div>

          {isEmpty ? (
            <div className="mt-4 rounded border border-grey-3 bg-grey-1 p-4 text-sm text-color-text-light">
              No tagged passages on this page.
            </div>
          ) : (
            <div
              className="mt-4 overflow-auto rounded border border-grey-3 bg-white"
              style={{ maxHeight: '620px' }}
            >
              <svg
                className="block min-w-[640px]"
                role="img"
                aria-label="Graph of annotation tags and highlighted passages"
                viewBox={`0 0 ${GRAPH_WIDTH} ${graphHeight}`}
                style={{
                  height: `${graphHeight}px`,
                  width: '100%',
                }}
              >
                <defs>
                  <filter
                    id="node-link-shadow"
                    x="-20%"
                    y="-20%"
                    width="140%"
                    height="140%"
                  >
                    <feDropShadow
                      dx="0"
                      dy="1"
                      stdDeviation="1.4"
                      floodColor="#000"
                      floodOpacity="0.14"
                    />
                  </filter>
                </defs>

                {visibleEdges.map(edge => {
                  const source = tagPositions.get(edge.source);
                  const target = quotePositions.get(edge.target);
                  if (!source || !target) {
                    return null;
                  }

                  const isActive =
                    hoveredNodeId === edge.source ||
                    hoveredNodeId === edge.target ||
                    selectedTag === edge.tag;
                  const color = tagColor(edge.tag, palette);
                  return (
                    <path
                      key={edge.id}
                      d={pathBetween(
                        {
                          x:
                            source.x +
                            tagNodeRadius(
                              graph.tagNodes.find(
                                node => node.id === edge.source,
                              )!,
                            ),
                          y: source.y,
                        },
                        { x: target.x, y: target.y },
                      )}
                      fill="none"
                      stroke={color}
                      stroke-width={isActive ? 3 : 1.6}
                      stroke-opacity={isActive ? 0.92 : 0.36}
                    />
                  );
                })}

                {graph.tagNodes.map(node => {
                  const position = tagPositions.get(node.id)!;
                  const selected = selectedTag === node.tag;
                  const related =
                    selected ||
                    visibleEdges.some(
                      edge =>
                        edge.source === node.id &&
                        hoveredNodeId === edge.target,
                    );
                  const color = tagColor(node.tag, palette);
                  const lines = wrappedLabel(node.tag, 18, 2);
                  const radius = tagNodeRadius(node);
                  return (
                    <g
                      key={node.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${node.tag}, ${node.annotationIds.length} passages`}
                      className="cursor-pointer focus-visible-ring"
                      onClick={() => toggleTag(node.tag)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleTag(node.tag);
                        }
                      }}
                      onMouseEnter={() => setHoveredNodeId(node.id)}
                      onMouseLeave={() => setHoveredNodeId(null)}
                      onFocus={() => setHoveredNodeId(node.id)}
                      onBlur={() => setHoveredNodeId(null)}
                    >
                      <circle
                        cx={position.x}
                        cy={position.y}
                        r={radius}
                        fill={color}
                        fill-opacity={selected || related ? 0.95 : 0.72}
                        stroke={selected ? '#111827' : '#ffffff'}
                        stroke-width={selected ? 2.5 : 2}
                        filter="url(#node-link-shadow)"
                      />
                      <text
                        x={position.x + radius + 12}
                        y={position.y - (lines.length - 1) * 8}
                        className="text-color-text font-semibold"
                        fill="currentColor"
                        font-size="14"
                      >
                        {lines.map((line, index) => (
                          <tspan
                            key={index}
                            x={position.x + radius + 12}
                            dy={index === 0 ? 0 : 16}
                          >
                            {line}
                          </tspan>
                        ))}
                      </text>
                      <text
                        x={position.x}
                        y={position.y + 4}
                        text-anchor="middle"
                        className="fill-white font-bold"
                        font-size="12"
                      >
                        {node.annotationIds.length}
                      </text>
                    </g>
                  );
                })}

                {visibleQuoteNodes.map(node => {
                  const position = quotePositions.get(node.id)!;
                  const isHovered = hoveredNodeId === node.id;
                  const lines = wrappedLabel(node.quote, 29, 2);
                  const firstTag = selectedTag ?? node.tags[0] ?? '';
                  const color = tagColor(firstTag, palette);
                  return (
                    <g
                      key={node.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Passage: ${compressedText(node.quote)}`}
                      className="cursor-pointer focus-visible-ring"
                      onClick={() => focusAnnotation(node)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          focusAnnotation(node);
                        }
                      }}
                      onMouseEnter={() => {
                        setHoveredNodeId(node.id);
                        hoverAnnotation(node);
                      }}
                      onMouseLeave={clearHover}
                      onFocus={() => {
                        setHoveredNodeId(node.id);
                        hoverAnnotation(node);
                      }}
                      onBlur={clearHover}
                    >
                      <rect
                        x={position.x}
                        y={position.y - QUOTE_HEIGHT / 2}
                        width={QUOTE_WIDTH}
                        height={QUOTE_HEIGHT}
                        rx="8"
                        fill={isHovered ? '#f8fafc' : '#ffffff'}
                        stroke={color}
                        stroke-width={isHovered ? 2.5 : 1.5}
                        filter="url(#node-link-shadow)"
                      />
                      <line
                        x1={position.x}
                        y1={position.y - QUOTE_HEIGHT / 2}
                        x2={position.x}
                        y2={position.y + QUOTE_HEIGHT / 2}
                        stroke={color}
                        stroke-width="6"
                        stroke-linecap="round"
                      />
                      <text
                        x={position.x + 17}
                        y={position.y - 8}
                        className="text-color-text"
                        fill="currentColor"
                        font-size="13"
                      >
                        {lines.map((line, index) => (
                          <tspan
                            key={index}
                            x={position.x + 17}
                            dy={index === 0 ? 0 : 16}
                          >
                            {line}
                          </tspan>
                        ))}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}

          {!isEmpty && (
            <div className="mt-3 flex flex-wrap gap-2">
              {graph.tagNodes.map(node => {
                const selected = selectedTag === node.tag;
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={classnames(
                      'rounded border px-2 py-1 text-xs focus-visible-ring',
                      selected
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-grey-3 bg-white text-color-text',
                    )}
                    onClick={() => toggleTag(node.tag)}
                  >
                    {node.tag}
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </SidebarPanel>
  );
}

export default withServices(NodeLinkPanel, ['frameSync']);
