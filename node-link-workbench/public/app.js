import {
  annotationDocumentId,
  annotationDocumentLabel,
  buildBridgeRankings,
  buildDocumentComparison,
  buildImplicitTagEdges,
  buildTagOnlyLayout,
  contentTags,
  documentLabelFromUrl,
  documentOptionsForAnnotations,
  edgeDisplayLabel,
  graphLayersForView,
  tagPairKey,
} from './graph-model.js';

const LAYOUT_VERSION = 3;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.35;
const ZOOM_STEP = 0.12;
const TAG_WIDTH = 190;
const TAG_HEIGHT = 56;
const QUOTE_WIDTH = 246;
const QUOTE_HEIGHT = 82;
const DOC_NODE_WIDTH = 218;
const DOC_NODE_HEIGHT = 58;
const GRAPH_MARGIN_X = 34;
const GRAPH_TOP = 72;
const TAG_CENTER_X = 150;
const LANE_START_X = 310;
const LANE_WIDTH = 286;
const LANE_GAP = 34;
const LANE_RAIL_GAP = 24;
const QUOTE_GAP = 12;
const ROW_GAP = 22;
const DOC_COLORS = [
  '#0f766e',
  '#7c3aed',
  '#c2410c',
  '#2563eb',
  '#be123c',
  '#15803d',
];

const els = {
  sessionLabel: document.querySelector('#sessionLabel'),
  groupSelect: document.querySelector('#groupSelect'),
  documentSelect: document.querySelector('#documentSelect'),
  refreshBtn: document.querySelector('#refreshBtn'),
  newTagBtn: document.querySelector('#newTagBtn'),
  newEdgeBtn: document.querySelector('#newEdgeBtn'),
  loginBtn: document.querySelector('#loginBtn'),
  colorModeSelect: document.querySelector('#colorModeSelect'),
  colorFocusSelect: document.querySelector('#colorFocusSelect'),
  tagOnlyToggle: document.querySelector('#tagOnlyToggle'),
  edgeEvidenceToggle: document.querySelector('#edgeEvidenceToggle'),
  edgeHumanToggle: document.querySelector('#edgeHumanToggle'),
  edgeImplicitToggle: document.querySelector('#edgeImplicitToggle'),
  documentComparisonToggle: document.querySelector('#documentComparisonToggle'),
  compareDocASelect: document.querySelector('#compareDocASelect'),
  compareDocBSelect: document.querySelector('#compareDocBSelect'),
  graphTitle: document.querySelector('#graphTitle'),
  graphStats: document.querySelector('#graphStats'),
  saveState: document.querySelector('#saveState'),
  zoomOutBtn: document.querySelector('#zoomOutBtn'),
  zoomInBtn: document.querySelector('#zoomInBtn'),
  fitBtn: document.querySelector('#fitBtn'),
  resetLayoutBtn: document.querySelector('#resetLayoutBtn'),
  zoomLabel: document.querySelector('#zoomLabel'),
  notice: document.querySelector('#notice'),
  canvasScroll: document.querySelector('#canvasScroll'),
  svg: document.querySelector('#graphSvg'),
  edgeEditor: document.querySelector('#edgeEditor'),
  edgeEditorTitle: document.querySelector('#edgeEditorTitle'),
  cancelEdgeBtn: document.querySelector('#cancelEdgeBtn'),
  edgeSource: document.querySelector('#edgeSource'),
  edgeTarget: document.querySelector('#edgeTarget'),
  edgeLabel: document.querySelector('#edgeLabel'),
  edgeContext: document.querySelector('#edgeContext'),
  saveEdgeBtn: document.querySelector('#saveEdgeBtn'),
  tagEditor: document.querySelector('#tagEditor'),
  tagEditorTitle: document.querySelector('#tagEditorTitle'),
  cancelTagBtn: document.querySelector('#cancelTagBtn'),
  tagName: document.querySelector('#tagName'),
  saveTagBtn: document.querySelector('#saveTagBtn'),
  selectionPanel: document.querySelector('#selectionPanel'),
  bridgeRanking: document.querySelector('#bridgeRanking'),
  comparisonPanel: document.querySelector('#comparisonPanel'),
  edgeList: document.querySelector('#edgeList'),
};

const state = {
  session: null,
  groups: [],
  snapshot: null,
  edits: null,
  graph: null,
  documentFilter: 'all',
  colorMode: 'tag',
  colorFocus: 'all',
  showQuotes: false,
  showImplicitConnections: false,
  edgeFilters: {
    evidence: true,
    human: true,
    implicit: true,
  },
  documentComparisonEnabled: false,
  compareDocumentA: '',
  compareDocumentB: '',
  zoom: 0.82,
  userZoomed: false,
  selectedNodeId: null,
  selectedEdgeId: null,
  tagDraft: null,
  expandedTags: new Set(),
  expandedDocuments: new Set(),
  edgeDraft: null,
  dragging: null,
  saveTimer: null,
};

function svgEl(name, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

function isActivationKey(event) {
  return event.key === 'Enter' || event.key === ' ';
}

function bindActivation(target, handler) {
  target.addEventListener('click', event => {
    event.stopPropagation();
    handler(event);
  });
  target.addEventListener('keydown', event => {
    if (!isActivationKey(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    handler(event);
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    const detail =
      typeof data.details === 'string'
        ? data.details
        : data.details?.reason || data.details?.message || '';
    const message = data.error || `Request failed: ${response.status}`;
    throw new Error(
      detail && detail !== message ? `${message}: ${detail}` : message,
    );
  }
  return data;
}

function debugAuth(event, details = {}) {
  fetch('/api/debug/auth-event', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event, details }),
  }).catch(() => {});
}

function showNotice(message) {
  if (!message) {
    els.notice.hidden = true;
    els.notice.textContent = '';
    return;
  }
  els.notice.hidden = false;
  els.notice.textContent = message;
}

function setSaveState(message) {
  els.saveState.textContent = message;
}

function shortText(text, max = 120) {
  const compact = (text || '').replace(/\s+/g, ' ').trim();
  return compact.length > max
    ? `${compact.slice(0, Math.max(0, max - 3))}...`
    : compact;
}

function wrapLines(text, maxChars, maxLines) {
  const compact = (text || '').replace(/\s+/g, ' ').trim();
  const words = compact.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  let truncated = false;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else if (word.length > maxChars) {
      lines.push(shortText(word, maxChars));
      line = '';
    } else {
      line = next;
    }
    if (lines.length === maxLines) {
      truncated = index < words.length - 1 || Boolean(line);
      break;
    }
  }
  if (line && lines.length < maxLines) {
    lines.push(line);
  }
  if (
    lines.length === maxLines &&
    words.join(' ').length > lines.join(' ').length
  ) {
    truncated = true;
  }
  if (truncated && lines.length) {
    lines[lines.length - 1] = shortText(lines[lines.length - 1], maxChars);
  }
  return lines;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function documentOptions() {
  return documentOptionsForAnnotations(state.snapshot?.annotations || []);
}

function selectedDocumentLabel() {
  if (state.documentFilter === 'all') {
    return 'All documents';
  }
  return (
    documentOptions().find(option => option.uri === state.documentFilter)
      ?.label || documentLabelFromUrl(state.documentFilter)
  );
}

function formatTagLabel(tag) {
  return {
    scope: 'Tag',
    name: tag,
  };
}

function documentColor(index) {
  return DOC_COLORS[index % DOC_COLORS.length];
}

function currentLayoutNodes() {
  const layout = state.edits?.layout;
  if (layout?.version !== LAYOUT_VERSION) {
    return {};
  }
  return layout.nodes || {};
}

function ensureCurrentLayout() {
  if (!state.edits) {
    return;
  }
  if (!Array.isArray(state.edits.descriptiveTags)) {
    state.edits.descriptiveTags = [];
  }
  if (!Array.isArray(state.edits.tagEdges)) {
    state.edits.tagEdges = [];
  }
  if (state.edits.layout?.version !== LAYOUT_VERSION) {
    state.edits.layout = {
      version: LAYOUT_VERSION,
      nodes: {},
    };
  }
}

function normalizeEditableTag(value) {
  return String(value || '').trim();
}

function descriptiveTags() {
  return state.edits?.descriptiveTags || [];
}

function annotationTagSet() {
  const tags = new Set();
  for (const ann of state.snapshot?.annotations || []) {
    if (ann.hidden || ann.isReply) {
      continue;
    }
    for (const tag of contentTags(ann.tags)) {
      tags.add(tag);
    }
  }
  return tags;
}

function knownTagSet({ ignoreDescriptiveId = null } = {}) {
  const tags = annotationTagSet();
  for (const item of descriptiveTags()) {
    if (item.id !== ignoreDescriptiveId) {
      tags.add(item.tag);
    }
  }
  return tags;
}

function descriptiveTagById(id) {
  return descriptiveTags().find(item => item.id === id) || null;
}

function tagEdgeReferences(tag) {
  return (state.edits?.tagEdges || []).filter(
    edge => edge.sourceTag === tag || edge.targetTag === tag,
  );
}

function validateDescriptiveTagName(tag, { ignoreDescriptiveId = null } = {}) {
  if (!tag) {
    return 'Enter a tag name.';
  }
  if (knownTagSet({ ignoreDescriptiveId }).has(tag)) {
    return 'That tag already exists.';
  }
  return '';
}

function moveTagLayoutPosition(oldTag, newTag) {
  ensureCurrentLayout();
  const nodes = state.edits?.layout?.nodes;
  if (!nodes) {
    return;
  }
  const oldKey = `tag-only:tag:${oldTag}`;
  const newKey = `tag-only:tag:${newTag}`;
  if (nodes[oldKey] && !nodes[newKey]) {
    nodes[newKey] = nodes[oldKey];
  }
  delete nodes[oldKey];
}

function deleteTagLayoutPosition(tag) {
  ensureCurrentLayout();
  const nodes = state.edits?.layout?.nodes;
  if (nodes) {
    delete nodes[`tag-only:tag:${tag}`];
  }
}

function rewriteManualEdgesForTag(oldTag, newTag) {
  for (const edge of state.edits?.tagEdges || []) {
    if (edge.sourceTag === oldTag) {
      edge.sourceTag = newTag;
    }
    if (edge.targetTag === oldTag) {
      edge.targetTag = newTag;
    }
    if (edge.sourceTag === newTag || edge.targetTag === newTag) {
      edge.updatedAt = new Date().toISOString();
    }
  }
}

function hashColor(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 52% 36%)`;
}

function layoutPositionKey(node) {
  return `tag-only:${node.id}`;
}

function expansionKey(tag, documentUri) {
  return `${tag}\u0000${documentUri}`;
}

function tagOnlySavedPositions() {
  const saved = {};
  const nodes = currentLayoutNodes();
  for (const [key, position] of Object.entries(nodes)) {
    if (key.startsWith('tag-only:')) {
      saved[key.slice('tag-only:'.length)] = position;
    }
  }
  return saved;
}

function selectedTag() {
  if (!state.selectedNodeId?.startsWith('tag:')) {
    return null;
  }
  return state.selectedNodeId.slice('tag:'.length);
}

function buildFocusedTagNeighbors(focusedTag, edges) {
  const neighbors = new Set();
  if (!focusedTag) {
    return neighbors;
  }
  for (const edge of edges) {
    if (edge.sourceTag === focusedTag) {
      neighbors.add(edge.targetTag);
    } else if (edge.targetTag === focusedTag) {
      neighbors.add(edge.sourceTag);
    }
  }
  return neighbors;
}

function documentColorForUri(uri, lanes) {
  const lane = lanes.find(item => item.uri === uri);
  if (lane) {
    return lane.color;
  }
  const options = documentOptions();
  const index = Math.max(
    0,
    options.findIndex(option => option.uri === uri),
  );
  return documentColor(index);
}

function annotationSort(a, b) {
  return (
    annotationDocumentLabel(a).localeCompare(annotationDocumentLabel(b)) ||
    String(a.created || '').localeCompare(String(b.created || ''))
  );
}

function quoteSort(a, b) {
  return annotationSort(a.annotation, b.annotation);
}

function buildDrilldownGraph({ tagNodes, quoteNodes, lanes, width, height }) {
  const drillNodes = [];
  const evidenceEdges = [];
  let graphWidth = width;
  let graphHeight = height;
  const quotesByTagDocument = new Map();

  for (const quoteNode of quoteNodes) {
    const key = expansionKey(quoteNode.primaryTag, quoteNode.documentUri);
    const list = quotesByTagDocument.get(key) || [];
    list.push(quoteNode);
    quotesByTagDocument.set(key, list);
  }

  for (const tagNode of tagNodes) {
    if (!state.expandedTags.has(tagNode.tag)) {
      continue;
    }

    const documentEntries = [...quotesByTagDocument.entries()]
      .filter(([key]) => key.startsWith(`${tagNode.tag}\u0000`))
      .map(([key, quotes]) => {
        const documentUri = key.slice(tagNode.tag.length + 1);
        const sortedQuotes = [...quotes].sort(quoteSort);
        return {
          documentUri,
          label: annotationDocumentLabel(sortedQuotes[0].annotation),
          quotes: sortedQuotes,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    const totalDocHeight =
      documentEntries.length * DOC_NODE_HEIGHT +
      Math.max(0, documentEntries.length - 1) * 34;
    const docStartY = tagNode.y - totalDocHeight / 2 + DOC_NODE_HEIGHT / 2;
    const documentX = tagNode.x + TAG_WIDTH / 2 + 170;

    documentEntries.forEach((entry, index) => {
      const documentKey = expansionKey(tagNode.tag, entry.documentUri);
      const documentNode = {
        id: `document:${encodeURIComponent(tagNode.tag)}:${encodeURIComponent(
          entry.documentUri,
        )}`,
        type: 'document',
        tag: tagNode.tag,
        documentUri: entry.documentUri,
        label: entry.label,
        count: entry.quotes.length,
        x: documentX,
        y: docStartY + index * (DOC_NODE_HEIGHT + 34),
        color: documentColorForUri(entry.documentUri, lanes),
        expanded: state.expandedDocuments.has(documentKey),
      };
      drillNodes.push(documentNode);
      evidenceEdges.push({
        id: `evidence:tag-document:${encodeURIComponent(
          tagNode.tag,
        )}:${encodeURIComponent(entry.documentUri)}`,
        type: 'evidence',
        evidenceKind: 'tag-document',
        source: tagNode.id,
        target: documentNode.id,
        sourceTag: tagNode.tag,
        documentUri: entry.documentUri,
        documentLabel: entry.label,
        quoteCount: entry.quotes.length,
      });

      graphWidth = Math.max(
        graphWidth,
        documentNode.x + DOC_NODE_WIDTH / 2 + GRAPH_MARGIN_X,
      );
      graphHeight = Math.max(
        graphHeight,
        documentNode.y + DOC_NODE_HEIGHT / 2 + GRAPH_MARGIN_X,
      );

      if (!documentNode.expanded) {
        return;
      }

      const totalQuoteHeight =
        entry.quotes.length * QUOTE_HEIGHT +
        Math.max(0, entry.quotes.length - 1) * 18;
      const quoteStartY =
        documentNode.y - totalQuoteHeight / 2 + QUOTE_HEIGHT / 2;
      const quoteX = documentNode.x + DOC_NODE_WIDTH / 2 + QUOTE_WIDTH / 2 + 74;

      entry.quotes.forEach((sourceQuote, quoteIndex) => {
        const quoteNode = {
          ...sourceQuote,
          id: `evidence-quote:${encodeURIComponent(
            tagNode.tag,
          )}:${encodeURIComponent(entry.documentUri)}:${encodeURIComponent(
            sourceQuote.annotation.id || quoteIndex,
          )}`,
          type: 'evidence-quote',
          x: quoteX,
          y: quoteStartY + quoteIndex * (QUOTE_HEIGHT + 18),
          documentColor: documentNode.color,
        };
        drillNodes.push(quoteNode);
        evidenceEdges.push({
          id: `evidence:document-quote:${encodeURIComponent(
            tagNode.tag,
          )}:${encodeURIComponent(entry.documentUri)}:${encodeURIComponent(
            sourceQuote.annotation.id || quoteIndex,
          )}`,
          type: 'evidence',
          evidenceKind: 'document-quote',
          source: documentNode.id,
          target: quoteNode.id,
          sourceTag: tagNode.tag,
          documentUri: entry.documentUri,
          documentLabel: entry.label,
          annotation: sourceQuote.annotation,
        });
        graphWidth = Math.max(
          graphWidth,
          quoteNode.x + QUOTE_WIDTH / 2 + GRAPH_MARGIN_X,
        );
        graphHeight = Math.max(
          graphHeight,
          quoteNode.y + QUOTE_HEIGHT / 2 + GRAPH_MARGIN_X,
        );
      });
    });
  }

  return {
    drillNodes,
    evidenceEdges,
    width: graphWidth,
    height: graphHeight,
  };
}

function buildGraph() {
  ensureCurrentLayout();
  const snapshot = state.snapshot || { annotations: [] };
  const tagMap = new Map();
  const quoteNodes = [];
  const autoEdges = [];
  const laneMap = new Map();

  const annotations = (snapshot.annotations || []).filter(ann => {
    if (ann.hidden || ann.isReply) {
      return false;
    }
    return (
      state.documentFilter === 'all' ||
      annotationDocumentId(ann) === state.documentFilter
    );
  });

  for (const ann of annotations) {
    const tags = contentTags(ann.tags);
    const docUri = annotationDocumentId(ann);
    if (ann.quote && docUri && !laneMap.has(docUri)) {
      laneMap.set(docUri, {
        uri: docUri,
        label: annotationDocumentLabel(ann),
      });
    }

    for (const tag of tags) {
      if (!tagMap.has(tag)) {
        tagMap.set(tag, {
          id: `tag:${tag}`,
          type: 'tag',
          tag,
          count: 0,
          documentUris: new Set(),
        });
      }
      const tagNode = tagMap.get(tag);
      tagNode.count += 1;
      if (docUri) {
        tagNode.documentUris.add(docUri);
      }
    }

    if (!ann.quote) {
      continue;
    }

    for (const tag of tags) {
      const quoteNode = {
        id: `quote:${tag}:${ann.id}`,
        type: 'quote',
        annotation: ann,
        tags,
        primaryTag: tag,
        documentUri: docUri,
      };
      quoteNodes.push(quoteNode);
      autoEdges.push({
        id: `auto:${tag}:${ann.id}`,
        type: 'auto',
        source: `tag:${tag}`,
        target: quoteNode.id,
        sourceTag: tag,
        annotation: ann,
      });
    }
  }

  for (const item of descriptiveTags()) {
    const tag = normalizeEditableTag(item.tag);
    if (!tag || tagMap.has(tag)) {
      continue;
    }
    tagMap.set(tag, {
      id: `tag:${tag}`,
      type: 'tag',
      tag,
      count: 0,
      documentUris: new Set(),
      descriptive: true,
      descriptiveTagId: item.id,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }

  const tagNodes = [...tagMap.values()].sort((a, b) =>
    a.tag.localeCompare(b.tag),
  );
  quoteNodes.sort((a, b) => {
    const tagA = a.primaryTag || '';
    const tagB = b.primaryTag || '';
    return (
      tagA.localeCompare(tagB) ||
      annotationDocumentLabel(a.annotation).localeCompare(
        annotationDocumentLabel(b.annotation),
      ) ||
      a.annotation.created.localeCompare(b.annotation.created)
    );
  });

  const lanes = [...laneMap.values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  if (!lanes.length) {
    lanes.push({ uri: 'none', label: 'No quoted annotations' });
  }
  lanes.forEach((lane, index) => {
    lane.index = index;
    lane.x = LANE_START_X + index * (LANE_WIDTH + LANE_GAP);
    lane.color = documentColor(index);
  });

  const laneByUri = new Map(lanes.map(lane => [lane.uri, lane]));
  const quoteNodesByTag = new Map();
  for (const node of quoteNodes) {
    const list = quoteNodesByTag.get(node.primaryTag) || [];
    list.push(node);
    quoteNodesByTag.set(node.primaryTag, list);
  }

  const rowBands = [];
  let cursorY = GRAPH_TOP;
  for (const tagNode of tagNodes) {
    const rowQuotes = quoteNodesByTag.get(tagNode.tag) || [];
    const laneCounts = new Map(lanes.map(lane => [lane.uri, 0]));
    for (const quoteNode of rowQuotes) {
      laneCounts.set(
        quoteNode.documentUri,
        (laneCounts.get(quoteNode.documentUri) || 0) + 1,
      );
    }
    const maxLaneQuotes = Math.max(1, ...laneCounts.values());
    const rowHeight = Math.max(
      118,
      maxLaneQuotes * QUOTE_HEIGHT + (maxLaneQuotes - 1) * QUOTE_GAP + 34,
    );
    const rowCenterY = cursorY + rowHeight / 2;
    Object.assign(tagNode, {
      x: TAG_CENTER_X,
      y: rowCenterY,
      color: hashColor(tagNode.tag),
      documentUris: [...tagNode.documentUris],
      docCount: tagNode.documentUris.size,
      rowY: cursorY,
      rowHeight,
    });

    rowBands.push({
      tag: tagNode.tag,
      y: cursorY,
      height: rowHeight,
    });

    const quoteLaneIndex = new Map();
    for (const quoteNode of rowQuotes) {
      const lane = laneByUri.get(quoteNode.documentUri) || lanes[0];
      const index = quoteLaneIndex.get(lane.uri) || 0;
      quoteLaneIndex.set(lane.uri, index + 1);
      const laneQuoteCount = laneCounts.get(lane.uri) || 1;
      const laneBlockHeight =
        laneQuoteCount * QUOTE_HEIGHT + (laneQuoteCount - 1) * QUOTE_GAP;
      const fallbackX = lane.x + LANE_WIDTH / 2;
      const fallbackY =
        cursorY +
        (rowHeight - laneBlockHeight) / 2 +
        index * (QUOTE_HEIGHT + QUOTE_GAP) +
        QUOTE_HEIGHT / 2;
      Object.assign(quoteNode, {
        x: fallbackX,
        y: fallbackY,
        laneIndex: lane.index,
        documentColor: lane.color,
      });
    }

    cursorY += rowHeight + ROW_GAP;
  }

  const visibleTags = new Set(tagNodes.map(node => node.tag));
  const humanEdges = (state.edits?.tagEdges || [])
    .filter(
      edge =>
        visibleTags.has(edge.sourceTag) && visibleTags.has(edge.targetTag),
    )
    .map(edge => ({
      ...edge,
      type: 'human',
      source: `tag:${edge.sourceTag}`,
      target: `tag:${edge.targetTag}`,
    }));

  const implicitEdges = buildImplicitTagEdges({
    tagNodes,
    tagEdges: humanEdges,
    documentOptions: documentOptions(),
  });
  const tagOnlyFocusedTag = !state.showQuotes ? selectedTag() : null;
  const tagOnlyFocusedNeighbors = buildFocusedTagNeighbors(tagOnlyFocusedTag, [
    ...humanEdges,
    ...implicitEdges,
  ]);
  let width =
    LANE_START_X +
    lanes.length * LANE_WIDTH +
    Math.max(0, lanes.length - 1) * LANE_GAP +
    GRAPH_MARGIN_X;
  let height = Math.max(620, cursorY + 36);

  if (!state.showQuotes) {
    const tagOnlyLayout = buildTagOnlyLayout({
      tagNodes,
      edges: [...humanEdges, ...implicitEdges],
      savedPositions: tagOnlySavedPositions(),
      nodeWidth: TAG_WIDTH,
      nodeHeight: TAG_HEIGHT,
      focusedTag: tagOnlyFocusedTag,
    });
    width = tagOnlyLayout.width;
    height = tagOnlyLayout.height;
    rowBands.length = 0;
    for (const tagNode of tagNodes) {
      const position = tagOnlyLayout.positions[tagNode.id];
      Object.assign(tagNode, {
        x: position.x,
        y: position.y,
        rowY: null,
        rowHeight: null,
      });
    }
  }

  let drillNodes = [];
  let evidenceEdges = [];
  if (!state.showQuotes) {
    const drilldown = buildDrilldownGraph({
      tagNodes,
      quoteNodes,
      lanes,
      width,
      height,
    });
    drillNodes = drilldown.drillNodes;
    evidenceEdges = drilldown.evidenceEdges;
    width = drilldown.width;
    height = drilldown.height;
  }

  const nodes = [...tagNodes, ...quoteNodes, ...drillNodes];
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const bridgeRankings = buildBridgeRankings({
    tagNodes,
    humanEdges,
    implicitEdges,
  });
  const comparison = buildDocumentComparison({
    tagNodes,
    documentA: state.documentComparisonEnabled ? state.compareDocumentA : '',
    documentB: state.documentComparisonEnabled ? state.compareDocumentB : '',
  });

  state.graph = {
    width,
    height,
    annotations,
    nodes,
    tagNodes,
    quoteNodes,
    drillNodes,
    autoEdges,
    evidenceEdges,
    humanEdges,
    implicitEdges,
    bridgeRankings,
    comparison,
    tagOnlyFocusedTag,
    tagOnlyFocusedNeighbors,
    lanes,
    rowBands,
    nodeById,
    visibleTags,
  };
}

function nodeDimensions(node) {
  if (node.type === 'quote' || node.type === 'evidence-quote') {
    return { width: QUOTE_WIDTH, height: QUOTE_HEIGHT };
  }
  if (node.type === 'document') {
    return { width: DOC_NODE_WIDTH, height: DOC_NODE_HEIGHT };
  }
  return { width: TAG_WIDTH, height: TAG_HEIGHT };
}

function nodeLeft(node) {
  return node.x - nodeDimensions(node).width / 2;
}

function nodeRight(node) {
  return node.x + nodeDimensions(node).width / 2;
}

function nodeBoundaryPoint(node, toward) {
  const dimensions = nodeDimensions(node);
  const halfWidth = dimensions.width / 2;
  const halfHeight = dimensions.height / 2;
  const dx = toward.x - node.x;
  const dy = toward.y - node.y;
  if (dx === 0 && dy === 0) {
    return { x: node.x, y: node.y };
  }
  const scale = Math.min(
    halfWidth / Math.max(0.001, Math.abs(dx)),
    halfHeight / Math.max(0.001, Math.abs(dy)),
  );
  return {
    x: node.x + dx * scale,
    y: node.y + dy * scale,
  };
}

function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  if (value.length !== 6) {
    return hex;
  }
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function tagDocuments(node) {
  return Array.isArray(node.documentUris) ? node.documentUris : [];
}

function tagTouchesFocus(node) {
  return (
    state.colorFocus === 'all' || tagDocuments(node).includes(state.colorFocus)
  );
}

function comparisonRoleForTag(tag) {
  const comparison = state.graph?.comparison;
  if (!comparison?.enabled) {
    return 'off';
  }
  if (comparison.shared.includes(tag)) {
    return 'shared';
  }
  if (comparison.onlyA.includes(tag)) {
    return 'onlyA';
  }
  if (comparison.onlyB.includes(tag)) {
    return 'onlyB';
  }
  return 'neither';
}

function comparisonTagStyle(role) {
  if (role === 'shared') {
    return { fill: '#0f766e', opacity: 1 };
  }
  if (role === 'onlyA') {
    return { fill: '#2563eb', opacity: 1 };
  }
  if (role === 'onlyB') {
    return { fill: '#b45309', opacity: 1 };
  }
  if (role === 'neither') {
    return { fill: '#8d9a97', opacity: 0.18 };
  }
  return null;
}

function tagVisual(node) {
  const comparisonStyle = comparisonTagStyle(comparisonRoleForTag(node.tag));
  if (comparisonStyle) {
    return comparisonStyle;
  }

  if (state.colorMode === 'document') {
    if (state.colorFocus !== 'all' && tagTouchesFocus(node)) {
      const lane = state.graph.lanes.find(
        item => item.uri === state.colorFocus,
      );
      return { fill: lane?.color || node.color, opacity: 1 };
    }
    return {
      fill: state.colorFocus === 'all' ? '#516360' : '#80908d',
      opacity: state.colorFocus === 'all' || tagTouchesFocus(node) ? 1 : 0.24,
    };
  }

  if (state.colorMode === 'bridge') {
    return {
      fill: node.docCount > 1 ? '#0f766e' : '#8d9a97',
      opacity: node.docCount > 1 ? 1 : 0.32,
    };
  }

  if (state.colorMode === 'density') {
    const fill =
      node.count >= 5
        ? '#be123c'
        : node.count >= 4
          ? '#b45309'
          : node.count >= 3
            ? '#0f766e'
            : '#2563eb';
    return {
      fill,
      opacity: 1,
    };
  }

  return { fill: node.color, opacity: 1 };
}

function documentVisual(node) {
  if (state.graph?.comparison?.enabled) {
    if (node.documentUri === state.graph.comparison.documentA) {
      return {
        fill: '#eff6ff',
        stroke: '#2563eb',
        opacity: 1,
        port: '#2563eb',
      };
    }
    if (node.documentUri === state.graph.comparison.documentB) {
      return {
        fill: '#fff7ed',
        stroke: '#b45309',
        opacity: 1,
        port: '#b45309',
      };
    }
    return {
      fill: '#f4f6f6',
      stroke: '#cbd8d6',
      opacity: 0.28,
      port: '#9aa8a6',
    };
  }
  return {
    fill: hexToRgba(node.color || '#0f766e', 0.12),
    stroke: node.color || '#0f766e',
    opacity: 1,
    port: node.color || '#0f766e',
  };
}

function quoteVisual(node) {
  const tagNode = state.graph.nodeById.get(`tag:${node.primaryTag}`);
  const tagStyle = tagNode
    ? tagVisual(tagNode)
    : { fill: '#7c8a87', opacity: 1 };

  if (state.graph?.comparison?.enabled) {
    const role = comparisonRoleForTag(node.primaryTag);
    const style = comparisonTagStyle(role);
    const documentFocused =
      node.documentUri === state.graph.comparison.documentA ||
      node.documentUri === state.graph.comparison.documentB;
    return {
      fill: documentFocused
        ? hexToRgba(style?.fill || '#d7a940', 0.12)
        : '#f4f6f6',
      stroke: documentFocused ? style?.fill || tagStyle.fill : '#cbd8d6',
      opacity: documentFocused && role !== 'neither' ? 1 : 0.24,
      port: documentFocused ? style?.fill || tagStyle.fill : '#9aa8a6',
    };
  }

  if (state.colorMode === 'document') {
    const focused =
      state.colorFocus === 'all' || node.documentUri === state.colorFocus;
    return {
      fill: focused ? hexToRgba(node.documentColor, 0.15) : '#f1f5f5',
      stroke: focused ? node.documentColor : '#c8d4d2',
      opacity: focused ? 1 : 0.24,
      port: focused ? node.documentColor : '#9aa8a6',
    };
  }

  if (state.colorMode === 'bridge') {
    const bridge = (tagNode?.docCount || 0) > 1;
    return {
      fill: bridge ? '#eef8f4' : '#f4f6f6',
      stroke: bridge ? '#0f766e' : '#cbd8d6',
      opacity: bridge ? 1 : 0.32,
      port: bridge ? '#0f766e' : '#9aa8a6',
    };
  }

  if (state.colorMode === 'density') {
    return {
      fill: hexToRgba('#d7a940', clamp((tagNode?.count || 1) / 18, 0.08, 0.22)),
      stroke: tagStyle.fill,
      opacity: 1,
      port: tagStyle.fill,
    };
  }

  return {
    fill: '#fffaf0',
    stroke: '#d7a940',
    opacity: 1,
    port: tagStyle.fill,
  };
}

function visualForEdgeNode(node) {
  if (node.type === 'tag') {
    const visual = tagVisual(node);
    return { ...visual, port: visual.fill };
  }
  if (node.type === 'document') {
    return documentVisual(node);
  }
  return quoteVisual(node);
}

function tagFocusOpacity(node) {
  if (state.showQuotes || !state.graph?.tagOnlyFocusedTag) {
    return 1;
  }
  if (
    node.tag === state.graph.tagOnlyFocusedTag ||
    state.graph.tagOnlyFocusedNeighbors.has(node.tag)
  ) {
    return 1;
  }
  return 0.26;
}

function edgeVisual(edge, source, target) {
  const selected = edgeIsSelected(edge);
  const sourceStyle = visualForEdgeNode(source);
  const targetStyle = visualForEdgeNode(target);
  const color =
    state.colorMode === 'document' &&
    (target.type === 'quote' || target.type === 'evidence-quote')
      ? targetStyle.port
      : sourceStyle.port || sourceStyle.fill || '#7c8a87';
  const colorMuted =
    (sourceStyle?.opacity ?? 1) < 1 || (targetStyle?.opacity ?? 1) < 1;
  return {
    color,
    muted: colorMuted,
    selected,
  };
}

function autoEdgePath(source, target) {
  const startX = nodeRight(source);
  const endX = nodeLeft(target);
  const startY = source.y;
  const endY = target.y;
  const railX = endX - LANE_RAIL_GAP;
  const busY = Number.isFinite(source.rowY) ? source.rowY + 22 : startY;
  const curve = 16;
  return `M ${startX} ${startY} C ${startX + curve} ${startY}, ${startX + curve} ${busY}, ${startX + curve * 2} ${busY} L ${railX} ${busY} L ${railX} ${endY} C ${railX} ${endY}, ${endX - curve} ${endY}, ${endX} ${endY}`;
}

function evidenceEdgePath(source, target) {
  const start = nodeBoundaryPoint(source, target);
  const end = nodeBoundaryPoint(target, source);
  const dx = end.x - start.x;
  const curve = clamp(Math.abs(dx) * 0.5, 52, 150);
  return `M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${end.x - curve} ${end.y}, ${end.x} ${end.y}`;
}

function tagEdgePath(source, target, index) {
  const start = nodeBoundaryPoint(source, target);
  const end = nodeBoundaryPoint(target, source);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const direction = index % 2 === 0 ? 1 : -1;
  const bow = clamp(distance * 0.14 + (index % 5) * 8, 30, 96);
  const c1x = start.x + dx * 0.38 + normalX * direction * bow;
  const c1y = start.y + dy * 0.38 + normalY * direction * bow;
  const c2x = end.x - dx * 0.38 + normalX * direction * bow;
  const c2y = end.y - dy * 0.38 + normalY * direction * bow;
  return `M ${start.x} ${start.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`;
}

function edgeIsSelected(edge) {
  if (state.selectedEdgeId) {
    return edge.id === state.selectedEdgeId;
  }
  return (
    Boolean(state.selectedNodeId) &&
    (edge.source === state.selectedNodeId ||
      edge.target === state.selectedNodeId)
  );
}

function tagEdgeVisibleInCurrentFocus(edge) {
  const focusedTag = state.graph?.tagOnlyFocusedTag;
  if (state.showQuotes || !focusedTag) {
    return true;
  }
  return edge.sourceTag === focusedTag || edge.targetTag === focusedTag;
}

function edgeVisibleInLayers(edge, layers) {
  if (!edge) {
    return false;
  }
  if (edge.type === 'auto') {
    return layers.showAutoEdges;
  }
  if (edge.type === 'evidence') {
    return layers.showEvidenceEdges;
  }
  if (edge.type === 'human') {
    return layers.showHumanEdges && tagEdgeVisibleInCurrentFocus(edge);
  }
  if (edge.type === 'implicit') {
    return layers.showImplicitEdges && tagEdgeVisibleInCurrentFocus(edge);
  }
  return false;
}

function renderAutoEdges(group, layers) {
  if (!layers.showAutoEdges) {
    return;
  }

  for (const edge of state.graph.autoEdges) {
    const source = state.graph.nodeById.get(edge.source);
    const target = state.graph.nodeById.get(edge.target);
    if (!source || !target) {
      continue;
    }
    const visual = edgeVisual(edge, source, target);
    const d = autoEdgePath(source, target);
    const edgeGroup = svgEl('g', {
      class: 'edge-interactive edge-auto-group',
    });
    const path = svgEl('path', {
      class: `edge-auto ${visual.muted ? 'edge-muted' : ''} ${visual.selected ? 'edge-active' : ''}`,
      d,
      stroke: visual.color,
    });
    const hitPath = svgEl('path', {
      class: 'edge-hit edge-auto-hit',
      d,
      tabindex: '0',
      role: 'button',
      'aria-label': `View evidence between ${source.tag} and quote`,
    });
    bindEdgeSelection(hitPath, edge);
    bindEdgeHover(hitPath, path);
    edgeGroup.append(path, hitPath);
    group.append(edgeGroup);
  }
}

function bindEdgeHover(hitPath, visiblePath) {
  const setHovered = hovered => {
    visiblePath.classList.toggle('edge-hovered', hovered);
  };
  hitPath.addEventListener('mouseenter', () => setHovered(true));
  hitPath.addEventListener('mouseleave', () => setHovered(false));
  hitPath.addEventListener('focus', () => setHovered(true));
  hitPath.addEventListener('blur', () => setHovered(false));
}

function bindEdgeSelection(hitPath, edge) {
  bindActivation(hitPath, () => selectEdge(edge.id));
}

function renderEvidenceEdges(group, layers) {
  if (!layers.showEvidenceEdges) {
    return;
  }

  for (const edge of state.graph.evidenceEdges) {
    const source = state.graph.nodeById.get(edge.source);
    const target = state.graph.nodeById.get(edge.target);
    if (!source || !target) {
      continue;
    }
    const visual = edgeVisual(edge, source, target);
    const d = evidenceEdgePath(source, target);
    const edgeGroup = svgEl('g', {
      class: 'edge-interactive edge-evidence-group',
    });
    const path = svgEl('path', {
      class: `edge-evidence ${visual.muted ? 'edge-muted' : ''} ${visual.selected ? 'edge-active' : ''}`,
      d,
      stroke: visual.color,
    });
    const hitPath = svgEl('path', {
      class: 'edge-hit edge-evidence-hit',
      d,
      tabindex: '0',
      role: 'button',
      'aria-label': `View evidence for ${edge.documentLabel || edge.sourceTag}`,
    });
    bindEdgeSelection(hitPath, edge);
    bindEdgeHover(hitPath, path);
    edgeGroup.append(path, hitPath);
    group.append(edgeGroup);
  }
}

function renderHumanEdges(group, layers) {
  if (!layers.showHumanEdges) {
    return;
  }

  state.graph.humanEdges.forEach((edge, index) => {
    if (!tagEdgeVisibleInCurrentFocus(edge)) {
      return;
    }
    const source = state.graph.nodeById.get(edge.source);
    const target = state.graph.nodeById.get(edge.target);
    if (!source || !target) {
      return;
    }
    const visual = edgeVisual(edge, source, target);
    const d = tagEdgePath(source, target, index);
    const edgeGroup = svgEl('g', {
      class: 'edge-interactive edge-human-group',
    });
    const path = svgEl('path', {
      class: `edge-human ${visual.muted ? 'edge-muted' : ''} ${visual.selected ? 'edge-active' : ''}`,
      d,
      stroke: visual.color,
    });
    edgeGroup.append(path);

    const hitPath = svgEl('path', {
      class: 'edge-hit edge-human-hit',
      d,
      tabindex: '0',
      role: 'button',
      'aria-label': `View real connection between ${edge.sourceTag} and ${edge.targetTag}`,
    });
    bindEdgeSelection(hitPath, edge);
    bindEdgeHover(hitPath, path);
    edgeGroup.append(hitPath);
    group.append(edgeGroup);
  });
}

function implicitEdgeSummary(edge) {
  const documents = edge.documentLabels.join(', ');
  return `Suggested by ${edge.generator.label.toLowerCase()} evidence: ${documents}.`;
}

function renderImplicitEdges(group, layers) {
  if (!layers.showImplicitEdges) {
    return;
  }

  state.graph.implicitEdges.forEach((edge, index) => {
    if (!tagEdgeVisibleInCurrentFocus(edge)) {
      return;
    }
    const source = state.graph.nodeById.get(edge.source);
    const target = state.graph.nodeById.get(edge.target);
    if (!source || !target) {
      return;
    }
    const visual = edgeVisual(edge, source, target);
    const d = tagEdgePath(
      source,
      target,
      index + state.graph.humanEdges.length,
    );
    const edgeGroup = svgEl('g', {
      class: 'edge-interactive edge-implicit-group',
    });
    const path = svgEl('path', {
      class: `edge-implicit ${visual.muted ? 'edge-muted' : ''} ${visual.selected ? 'edge-active' : ''}`,
      d,
      stroke: visual.color,
    });
    const hitPath = svgEl('path', {
      class: 'edge-hit edge-implicit-hit',
      d,
      tabindex: '0',
      role: 'button',
      'aria-label': `View suggested connection between ${edge.sourceTag} and ${edge.targetTag}`,
    });
    bindEdgeSelection(hitPath, edge);
    bindEdgeHover(hitPath, path);
    edgeGroup.append(path, hitPath);
    group.append(edgeGroup);
  });
}

function renderEdges(group, layers) {
  renderAutoEdges(group, layers);
  renderEvidenceEdges(group, layers);
  renderImplicitEdges(group, layers);
  renderHumanEdges(group, layers);
}

function startDrag(event, node) {
  if (state.showQuotes || node.type !== 'tag') {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const point = graphPoint(event);
  state.dragging = {
    id: node.id,
    offsetX: point.x - node.x,
    offsetY: point.y - node.y,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function graphPoint(event) {
  const rect = els.svg.getBoundingClientRect();
  const viewBox = els.svg.viewBox.baseVal;
  return {
    x: viewBox.x + ((event.clientX - rect.left) / rect.width) * viewBox.width,
    y: viewBox.y + ((event.clientY - rect.top) / rect.height) * viewBox.height,
  };
}

function handleDrag(event) {
  if (!state.dragging) {
    return;
  }
  const node = state.graph.nodeById.get(state.dragging.id);
  if (!node) {
    return;
  }
  const point = graphPoint(event);
  node.x = point.x - state.dragging.offsetX;
  node.y = point.y - state.dragging.offsetY;

  ensureCurrentLayout();
  state.edits.layout.nodes[layoutPositionKey(node)] = {
    x: Math.round(node.x),
    y: Math.round(node.y),
  };
  renderGraph();
  scheduleSave();
}

function stopDrag() {
  state.dragging = null;
}

function toggleTagExpansion(tag) {
  if (state.expandedTags.has(tag)) {
    state.expandedTags.delete(tag);
    for (const key of [...state.expandedDocuments]) {
      if (key.startsWith(`${tag}\u0000`)) {
        state.expandedDocuments.delete(key);
      }
    }
  } else {
    state.expandedTags.add(tag);
  }
  buildGraph();
  renderGraph();
}

function toggleDocumentExpansion(tag, documentUri) {
  const key = expansionKey(tag, documentUri);
  if (state.expandedDocuments.has(key)) {
    state.expandedDocuments.delete(key);
  } else {
    state.expandedDocuments.add(key);
  }
  buildGraph();
  renderGraph();
}

function renderExpansionButton(group, { x, y, expanded, label, onToggle }) {
  const button = svgEl('g', {
    class: 'expand-button',
    transform: `translate(${x} ${y})`,
    tabindex: '0',
    role: 'button',
    'aria-label': label,
  });
  button.append(
    svgEl('circle', {
      r: 11,
    }),
  );
  const text = svgEl('text', {
    x: 0,
    y: 4,
  });
  text.textContent = expanded ? '-' : '+';
  button.append(text);

  button.addEventListener('pointerdown', event => {
    event.stopPropagation();
  });
  bindActivation(button, onToggle);
  group.append(button);
}

function renderTagNode(group, node) {
  const x = node.x - TAG_WIDTH / 2;
  const y = node.y - TAG_HEIGHT / 2;
  const label = node.descriptive
    ? { scope: 'Descriptive', name: node.tag }
    : formatTagLabel(node.tag);
  const visual = tagVisual(node);
  const opacity = visual.opacity * tagFocusOpacity(node);
  const g = svgEl('g', {
    class: `node tag-node ${node.descriptive ? 'descriptive-tag-node' : ''} ${state.showQuotes ? '' : 'draggable-node'} ${node.id === state.selectedNodeId ? 'selected-node' : ''}`,
    transform: `translate(${x} ${y})`,
    opacity,
  });
  g.append(
    svgEl('rect', {
      width: TAG_WIDTH,
      height: TAG_HEIGHT,
      rx: 8,
      ry: 8,
      fill: visual.fill,
    }),
  );

  const scope = svgEl('text', {
    class: 'tag-scope',
    x: 14,
    y: 19,
  });
  scope.textContent = shortText(label.scope, 18);
  g.append(scope);

  const name = svgEl('text', {
    class: 'tag-name',
    x: 14,
    y: 39,
  });
  name.textContent = shortText(label.name, 23);
  g.append(name);

  const count = svgEl('text', {
    class: 'tag-count',
    x: TAG_WIDTH - 18,
    y: 20,
  });
  count.textContent = node.descriptive ? '' : String(node.count);
  g.append(count);

  if (!state.showQuotes && !node.descriptive && node.count > 0) {
    renderExpansionButton(g, {
      x: TAG_WIDTH - 18,
      y: TAG_HEIGHT - 14,
      expanded: state.expandedTags.has(node.tag),
      label: `${state.expandedTags.has(node.tag) ? 'Hide' : 'Show'} documents for ${node.tag}`,
      onToggle: () => toggleTagExpansion(node.tag),
    });
  }

  g.append(
    svgEl('circle', {
      class: 'node-port tag-port',
      cx: TAG_WIDTH,
      cy: TAG_HEIGHT / 2,
      r: 5,
      fill: visual.fill,
    }),
  );

  g.addEventListener('pointerdown', event => startDrag(event, node));
  g.addEventListener('click', () => selectNode(node.id));
  group.append(g);
}

function renderQuoteNode(group, node) {
  const x = node.x - QUOTE_WIDTH / 2;
  const y = node.y - QUOTE_HEIGHT / 2;
  const visual = quoteVisual(node);
  const g = svgEl('g', {
    class: `node quote-node ${node.id === state.selectedNodeId ? 'selected-node' : ''}`,
    transform: `translate(${x} ${y})`,
    opacity: visual.opacity,
  });
  g.append(
    svgEl('rect', {
      width: QUOTE_WIDTH,
      height: QUOTE_HEIGHT,
      rx: 8,
      ry: 8,
      fill: visual.fill,
      stroke: visual.stroke,
    }),
  );

  const title = svgEl('text', {
    class: 'quote-title',
    x: 12,
    y: 18,
  });
  title.textContent = shortText(annotationDocumentLabel(node.annotation), 30);
  g.append(title);

  const lines = wrapLines(node.annotation.quote, 32, 3);
  lines.forEach((line, index) => {
    const text = svgEl('text', {
      x: 12,
      y: 38 + index * 14,
    });
    text.textContent = line;
    g.append(text);
  });

  g.append(
    svgEl('circle', {
      class: 'node-port quote-port',
      cx: 0,
      cy: QUOTE_HEIGHT / 2,
      r: 4.5,
      fill: '#fff',
      stroke: visual.port,
    }),
  );

  g.addEventListener('pointerdown', event => startDrag(event, node));
  g.addEventListener('click', () => selectNode(node.id));
  group.append(g);
}

function renderDocumentNode(group, node) {
  const x = node.x - DOC_NODE_WIDTH / 2;
  const y = node.y - DOC_NODE_HEIGHT / 2;
  const visual = documentVisual(node);
  const g = svgEl('g', {
    class: `node document-node ${node.id === state.selectedNodeId ? 'selected-node' : ''}`,
    transform: `translate(${x} ${y})`,
    opacity: visual.opacity,
  });
  g.append(
    svgEl('rect', {
      width: DOC_NODE_WIDTH,
      height: DOC_NODE_HEIGHT,
      rx: 8,
      ry: 8,
      fill: visual.fill,
      stroke: visual.stroke,
    }),
  );

  const title = svgEl('text', {
    class: 'document-title',
    x: 12,
    y: 21,
  });
  title.textContent = shortText(node.label, 28);
  g.append(title);

  const count = svgEl('text', {
    class: 'document-count',
    x: 12,
    y: 42,
  });
  count.textContent = `${node.count} quote${node.count === 1 ? '' : 's'}`;
  g.append(count);

  renderExpansionButton(g, {
    x: DOC_NODE_WIDTH - 18,
    y: DOC_NODE_HEIGHT / 2,
    expanded: node.expanded,
    label: `${node.expanded ? 'Hide' : 'Show'} quotes from ${node.label}`,
    onToggle: () => toggleDocumentExpansion(node.tag, node.documentUri),
  });

  g.append(
    svgEl('circle', {
      class: 'node-port document-port',
      cx: 0,
      cy: DOC_NODE_HEIGHT / 2,
      r: 4.5,
      fill: '#fff',
      stroke: visual.port,
    }),
  );
  g.append(
    svgEl('circle', {
      class: 'node-port document-port',
      cx: DOC_NODE_WIDTH,
      cy: DOC_NODE_HEIGHT / 2,
      r: 4.5,
      fill: '#fff',
      stroke: visual.port,
    }),
  );

  g.addEventListener('click', () => selectNode(node.id));
  group.append(g);
}

function renderGuides(group) {
  if (state.showQuotes) {
    for (const [index, band] of state.graph.rowBands.entries()) {
      group.append(
        svgEl('rect', {
          class: `row-band ${index % 2 ? 'row-band-alt' : ''}`,
          x: GRAPH_MARGIN_X,
          y: band.y,
          width: state.graph.width - GRAPH_MARGIN_X * 2,
          height: band.height,
          rx: 10,
          ry: 10,
        }),
      );
    }
  }

  const tagLabel = svgEl('text', {
    class: 'lane-label',
    x: state.showQuotes ? TAG_CENTER_X - TAG_WIDTH / 2 : GRAPH_MARGIN_X,
    y: 34,
  });
  tagLabel.textContent = 'Tags';
  group.append(tagLabel);

  if (!state.showQuotes) {
    return;
  }

  for (const lane of state.graph.lanes) {
    const label = svgEl('text', {
      class: 'lane-label',
      x: lane.x,
      y: 34,
    });
    label.textContent = shortText(lane.label, 34);
    group.append(label);

    group.append(
      svgEl('line', {
        class: 'lane-rule',
        x1: lane.x,
        x2: lane.x,
        y1: 48,
        y2: state.graph.height - 24,
      }),
    );
  }
}

function applyZoom() {
  if (!state.graph) {
    return;
  }
  const zoom = clamp(state.zoom, MIN_ZOOM, MAX_ZOOM);
  els.svg.style.width = `${Math.round(state.graph.width * zoom)}px`;
  els.svg.style.height = `${Math.round(state.graph.height * zoom)}px`;
  els.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function setZoom(zoom, userInitiated = true) {
  state.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  if (userInitiated) {
    state.userZoomed = true;
  }
  applyZoom();
}

function fitGraphToWidth(userInitiated = true) {
  if (!state.graph) {
    return;
  }
  const availableWidth = Math.max(320, els.canvasScroll.clientWidth - 36);
  const maxFitZoom = userInitiated ? 1 : 0.9;
  setZoom(
    Math.min(maxFitZoom, availableWidth / state.graph.width),
    userInitiated,
  );
}

function maybeFitGraph() {
  if (!state.userZoomed) {
    fitGraphToWidth(false);
  } else {
    applyZoom();
  }
}

function resetLayout() {
  ensureCurrentLayout();
  state.edits.layout.nodes = {};
  state.userZoomed = false;
  buildGraph();
  maybeFitGraph();
  renderGraph();
  saveEditsNow().catch(err => showNotice(err.message));
}

function renderGraph() {
  if (!state.graph) {
    buildGraph();
  }

  const layers = graphLayersForView(state);
  if (!layers.showQuoteNodes && state.selectedNodeId?.startsWith('quote:')) {
    state.selectedNodeId = null;
  }
  if (state.selectedEdgeId) {
    const selectedEdge = findEdgeById(state.selectedEdgeId);
    if (!edgeVisibleInLayers(selectedEdge, layers)) {
      state.selectedEdgeId = null;
    }
  }

  els.svg.replaceChildren();
  els.svg.setAttribute('width', state.graph.width);
  els.svg.setAttribute('height', state.graph.height);
  els.svg.setAttribute(
    'viewBox',
    `0 0 ${state.graph.width} ${state.graph.height}`,
  );

  const guides = svgEl('g', { class: 'guides' });
  const edges = svgEl('g', { class: 'edges' });
  const nodes = svgEl('g', { class: 'nodes' });
  renderGuides(guides);
  renderEdges(edges, layers);
  const visibleNodes = layers.showQuoteNodes
    ? state.graph.nodes.filter(node => node.type !== 'document')
    : [...state.graph.tagNodes, ...state.graph.drillNodes];
  for (const node of visibleNodes) {
    if (node.type === 'tag') {
      renderTagNode(nodes, node);
    } else if (node.type === 'document') {
      renderDocumentNode(nodes, node);
    } else {
      renderQuoteNode(nodes, node);
    }
  }
  els.svg.append(guides, edges, nodes);
  renderSelection();
  renderBridgeRanking();
  renderDocumentComparison();
  renderEdgeList();
  updateGraphHeader();
  maybeFitGraph();
}

function selectNode(id) {
  const alreadySelected = state.selectedNodeId === id;
  state.selectedNodeId = !state.showQuotes && alreadySelected ? null : id;
  state.selectedEdgeId = null;
  if (!state.showQuotes) {
    buildGraph();
  }
  renderGraph();
}

function selectEdge(id) {
  state.selectedEdgeId = id;
  state.selectedNodeId = null;
  renderGraph();
}

function allGraphEdges() {
  if (!state.graph) {
    return [];
  }
  return [
    ...state.graph.autoEdges,
    ...state.graph.evidenceEdges,
    ...state.graph.humanEdges,
    ...state.graph.implicitEdges,
  ];
}

function findEdgeById(id) {
  return allGraphEdges().find(edge => edge.id === id) || null;
}

function sourceUrlForAnnotation(annotation) {
  return (
    annotation.links?.incontext || annotation.links?.html || annotation.uri
  );
}

function quotesForTag(tag) {
  const byAnnotationId = new Map();
  for (const quoteNode of state.graph?.quoteNodes || []) {
    if (!quoteNode.tags.includes(tag)) {
      continue;
    }
    const key = quoteNode.annotation.id || quoteNode.id;
    if (!byAnnotationId.has(key)) {
      byAnnotationId.set(key, quoteNode.annotation);
    }
  }
  return [...byAnnotationId.values()].sort(
    (a, b) =>
      annotationDocumentLabel(a).localeCompare(annotationDocumentLabel(b)) ||
      String(a.created || '').localeCompare(String(b.created || '')),
  );
}

function renderTagQuoteList(annotations) {
  if (!annotations.length) {
    return '<div class="empty-panel">No quoted annotations for this tag.</div>';
  }
  return `
    <details class="quote-details" open>
      <summary>Quotes and sources</summary>
      <div class="quote-list">
        ${annotations
          .map(ann => {
            const sourceUrl = sourceUrlForAnnotation(ann);
            return `
              <article class="quote-item">
                <div class="quote-item-source">${escapeHtml(shortText(annotationDocumentLabel(ann), 48))}</div>
                <div class="quote-item-text">${escapeHtml(ann.quote)}</div>
                <a class="quote-item-link" href="${escapeAttr(sourceUrl)}" target="_blank" rel="noopener">Open source</a>
              </article>
            `;
          })
          .join('')}
      </div>
    </details>
  `;
}

function annotationsForTagDocument(tag, documentUri) {
  return quotesForTag(tag)
    .filter(ann => annotationDocumentId(ann) === documentUri)
    .sort(annotationSort);
}

function renderEvidenceDocuments(evidence = []) {
  if (!evidence.length) {
    return '<div class="empty-panel">No saved evidence for this edge.</div>';
  }
  return `
    <div class="evidence-list">
      ${evidence
        .map(item => {
          const label = item.label || documentLabelFromUrl(item.uri || '');
          const href = item.uri || '#';
          return `
            <a class="evidence-item" href="${escapeAttr(href)}" target="_blank" rel="noopener">
              <span>${escapeHtml(label)}</span>
              <small>${escapeHtml(shortText(item.uri || '', 52))}</small>
            </a>
          `;
        })
        .join('')}
    </div>
  `;
}

function edgeSentenceHtml(sourceLabel, relationship, targetLabel) {
  const relation = relationship || 'connects to';
  return `
    <div class="edge-sentence-readout">
      ${sourceLabel ? `<span class="tag-chip">${escapeHtml(sourceLabel)}</span>` : ''}
      <strong>${escapeHtml(relation)}</strong>
      ${targetLabel ? `<span class="tag-chip">${escapeHtml(targetLabel)}</span>` : ''}
    </div>
  `;
}

function createdEdgeById(id) {
  return (state.edits?.tagEdges || []).find(edge => edge.id === id) || null;
}

function edgePairExists(sourceTag, targetTag, { ignoreEdgeId = null } = {}) {
  const pairKey = tagPairKey(sourceTag, targetTag);
  return (state.edits?.tagEdges || []).some(
    edge =>
      edge.id !== ignoreEdgeId &&
      tagPairKey(edge.sourceTag, edge.targetTag) === pairKey,
  );
}

function deleteCreatedEdge(edgeId) {
  state.edits.tagEdges = (state.edits.tagEdges || []).filter(
    edge => edge.id !== edgeId,
  );
  if (state.selectedEdgeId === edgeId) {
    state.selectedEdgeId = null;
  }
  if (state.edgeDraft?.editingEdgeId === edgeId) {
    closeEdgeEditor();
  }
  saveEditsNow();
  buildGraph();
  renderGraph();
}

function openTagEditor({ editTag = null } = {}) {
  state.tagDraft = editTag ? { editingTagId: editTag.id } : null;
  els.tagEditorTitle.textContent = editTag
    ? 'Edit Descriptive Tag'
    : 'Add Descriptive Tag';
  els.saveTagBtn.textContent = editTag ? 'Save Changes' : 'Save Tag';
  els.tagName.value = editTag?.tag || '';
  if (typeof els.tagEditor.showModal === 'function') {
    els.tagEditor.showModal();
  } else {
    els.tagEditor.setAttribute('open', '');
  }
  els.tagName.focus();
  els.tagName.select();
}

function closeTagEditor() {
  state.tagDraft = null;
  els.tagEditorTitle.textContent = 'Add Descriptive Tag';
  els.saveTagBtn.textContent = 'Save Tag';
  els.tagName.value = '';
  if (typeof els.tagEditor.close === 'function') {
    els.tagEditor.close();
  } else {
    els.tagEditor.removeAttribute('open');
  }
}

function deleteDescriptiveTag(tagId) {
  const tag = descriptiveTagById(tagId);
  if (!tag) {
    showNotice('That descriptive tag no longer exists.');
    buildGraph();
    renderGraph();
    return;
  }
  const references = tagEdgeReferences(tag.tag);
  if (references.length) {
    showNotice('Delete this tag after removing its manual tag-tag edges.');
    return;
  }

  state.edits.descriptiveTags = descriptiveTags().filter(
    item => item.id !== tagId,
  );
  state.expandedTags.delete(tag.tag);
  deleteTagLayoutPosition(tag.tag);
  if (state.selectedNodeId === `tag:${tag.tag}`) {
    state.selectedNodeId = null;
  }
  showNotice('');
  saveEditsNow();
  buildGraph();
  renderGraph();
}

function saveDescriptiveTag() {
  const tagName = normalizeEditableTag(els.tagName.value);
  const editingTagId = state.tagDraft?.editingTagId || null;
  const existing = editingTagId ? descriptiveTagById(editingTagId) : null;
  const validation = validateDescriptiveTagName(tagName, {
    ignoreDescriptiveId: editingTagId,
  });
  if (validation) {
    showNotice(validation);
    return;
  }

  const now = new Date().toISOString();
  showNotice('');
  ensureCurrentLayout();

  if (editingTagId) {
    if (!existing) {
      showNotice('That descriptive tag no longer exists.');
      closeTagEditor();
      buildGraph();
      renderGraph();
      return;
    }
    const oldTag = existing.tag;
    existing.tag = tagName;
    existing.updatedAt = now;
    if (oldTag !== tagName) {
      rewriteManualEdgesForTag(oldTag, tagName);
      moveTagLayoutPosition(oldTag, tagName);
      if (state.selectedNodeId === `tag:${oldTag}`) {
        state.selectedNodeId = `tag:${tagName}`;
      }
    }
    closeTagEditor();
    saveEditsNow();
    buildGraph();
    renderGraph();
    return;
  }

  state.edits.descriptiveTags.push({
    id: `descriptive-tag:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    tag: tagName,
    createdAt: now,
    updatedAt: now,
    createdBy: 'human',
  });
  closeTagEditor();
  saveEditsNow();
  buildGraph();
  renderGraph();
}

function renderEdgeSelection(edge) {
  const source = state.graph.nodeById.get(edge.source);
  const target = state.graph.nodeById.get(edge.target);
  const edgeKind =
    edge.type === 'human'
      ? 'Real tag edge'
      : edge.type === 'implicit'
        ? 'Suggested tag edge'
        : 'Evidence edge';
  const label = edgeDisplayLabel(edge);
  const sourceLabel =
    edge.sourceTag || source?.tag || source?.label || source?.primaryTag || '';
  const targetLabel =
    edge.targetTag || target?.tag || target?.label || target?.primaryTag || '';

  if (edge.type === 'human') {
    els.selectionPanel.className = '';
    els.selectionPanel.innerHTML = `
      ${edgeSentenceHtml(sourceLabel, label, targetLabel)}
      <div class="selection-actions">
        <button id="editSelectedEdgeBtn" class="button compact" type="button">Edit</button>
        <button id="deleteSelectedEdgeBtn" class="ghost-button danger" type="button">Delete</button>
      </div>
    `;
    document
      .querySelector('#editSelectedEdgeBtn')
      ?.addEventListener('click', () => openEdgeEditor({ editEdge: edge }));
    document
      .querySelector('#deleteSelectedEdgeBtn')
      ?.addEventListener('click', () => deleteCreatedEdge(edge.id));
    return;
  }

  let evidenceHtml = '';
  if (edge.type === 'implicit') {
    evidenceHtml = `
      <div class="edge-context">${escapeHtml(implicitEdgeSummary(edge))}</div>
      ${renderEvidenceDocuments(edge.evidence)}
      <button id="promoteImplicitBtn" class="button primary full-width" type="button">Promote to Real Edge</button>
    `;
  } else if (edge.evidenceKind === 'tag-document') {
    const annotations = annotationsForTagDocument(
      edge.sourceTag,
      edge.documentUri,
    );
    evidenceHtml = `
      <div class="selection-copy">${escapeHtml(edge.sourceTag)} appears in ${escapeHtml(edge.documentLabel)}.</div>
      ${renderTagQuoteList(annotations)}
    `;
  } else {
    const ann = edge.annotation || target?.annotation || edge.annotation;
    evidenceHtml = ann
      ? renderTagQuoteList([ann])
      : '<div class="empty-panel">No quote evidence found.</div>';
  }

  els.selectionPanel.className = '';
  els.selectionPanel.innerHTML = `
    <div class="selection-title">${escapeHtml(label || edgeKind)}</div>
    <div class="selection-copy">${escapeHtml(edgeKind)}</div>
    <div class="tag-chip-row">
      ${sourceLabel ? `<span class="tag-chip">${escapeHtml(sourceLabel)}</span>` : ''}
      ${targetLabel ? `<span class="tag-chip">${escapeHtml(targetLabel)}</span>` : ''}
    </div>
    ${evidenceHtml}
  `;

  document
    .querySelector('#promoteImplicitBtn')
    ?.addEventListener('click', () => {
      openEdgeEditor({
        sourceTag: edge.sourceTag,
        targetTag: edge.targetTag,
        implicitEdge: edge,
      });
    });
}

function renderSelection() {
  if (state.selectedEdgeId) {
    const edge = findEdgeById(state.selectedEdgeId);
    if (edge) {
      renderEdgeSelection(edge);
      return;
    }
  }

  const node = state.selectedNodeId
    ? state.graph?.nodeById.get(state.selectedNodeId)
    : null;
  if (!node) {
    els.selectionPanel.className = 'empty-panel';
    els.selectionPanel.textContent = 'Select a tag or quote node.';
    return;
  }

  els.selectionPanel.className = '';
  if (node.type === 'tag') {
    if (node.descriptive) {
      const references = tagEdgeReferences(node.tag);
      const canDelete = references.length === 0;
      els.selectionPanel.innerHTML = `
        <div class="selection-title">${escapeHtml(node.tag)}</div>
        <div class="selection-copy">Descriptive tag</div>
        <div class="tag-chip-row">
          <span class="tag-chip">${references.length} manual tag edge${references.length === 1 ? '' : 's'}</span>
          <span class="tag-chip">No quote evidence</span>
        </div>
        <div class="selection-actions">
          <button id="editSelectedTagBtn" class="button compact" type="button">Edit</button>
          <button id="deleteSelectedTagBtn" class="ghost-button danger" type="button" ${canDelete ? '' : 'disabled'} title="${canDelete ? 'Delete descriptive tag' : 'Remove its manual tag-tag edges before deleting'}">Delete</button>
        </div>
      `;
      document
        .querySelector('#editSelectedTagBtn')
        ?.addEventListener('click', () =>
          openTagEditor({
            editTag: descriptiveTagById(node.descriptiveTagId),
          }),
        );
      document
        .querySelector('#deleteSelectedTagBtn')
        ?.addEventListener('click', () =>
          deleteDescriptiveTag(node.descriptiveTagId),
        );
      return;
    }

    const relatedQuotes = quotesForTag(node.tag);
    const neighborCount = state.graph.tagOnlyFocusedNeighbors?.size || 0;
    els.selectionPanel.innerHTML = `
      <div class="selection-title">${escapeHtml(node.tag)}</div>
      <div class="selection-copy">${relatedQuotes.length} linked quotes${!state.showQuotes && node.tag === state.graph.tagOnlyFocusedTag ? ` / ${neighborCount} connected tags` : ''}</div>
      <div class="tag-chip-row">
        <span class="tag-chip">${node.count} annotations</span>
      </div>
      ${renderTagQuoteList(relatedQuotes)}
    `;
    return;
  }

  if (node.type === 'document') {
    const annotations = annotationsForTagDocument(node.tag, node.documentUri);
    els.selectionPanel.innerHTML = `
      <div class="selection-title">${escapeHtml(node.label)}</div>
      <div class="selection-copy">${escapeHtml(node.tag)} in this document</div>
      <div class="tag-chip-row">
        <span class="tag-chip">${node.count} linked quotes</span>
      </div>
      ${renderTagQuoteList(annotations)}
    `;
    return;
  }

  const ann = node.annotation;
  const sourceUrl = sourceUrlForAnnotation(ann);
  els.selectionPanel.innerHTML = `
    <div class="selection-title">${escapeHtml(shortText(annotationDocumentLabel(ann), 70))}</div>
    <div class="selection-copy">${escapeHtml(ann.quote)}</div>
    <div class="tag-chip-row">
      ${node.tags.map(tag => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join('')}
    </div>
    <div class="meta-list">
      <div class="meta-row"><span>Source</span><span>${escapeHtml(shortText(ann.uri, 54))}</span></div>
      <div class="meta-row"><span>Updated</span><span>${escapeHtml(formatDate(ann.updated))}</span></div>
      <div class="meta-row"><span>Id</span><span>${escapeHtml(ann.id || '')}</span></div>
    </div>
    <button id="openSourceBtn" class="button primary full-width">Open Source</button>
  `;
  document.querySelector('#openSourceBtn')?.addEventListener('click', () => {
    window.open(sourceUrl, '_blank', 'noopener');
  });
}

function documentLabelByUri(uri) {
  return (
    documentOptions().find(option => option.uri === uri)?.label ||
    documentLabelFromUrl(uri)
  );
}

function renderBridgeRanking() {
  if (!els.bridgeRanking) {
    return;
  }
  const rankings = state.graph?.bridgeRankings || [];
  if (!rankings.length) {
    els.bridgeRanking.innerHTML =
      '<div class="empty-panel">Refresh annotations to rank bridge tags.</div>';
    return;
  }

  els.bridgeRanking.innerHTML = rankings
    .slice(0, 12)
    .map((item, index) => {
      const selected = state.selectedNodeId === `tag:${item.tag}`;
      return `
        <button class="rank-item ${selected ? 'rank-item-selected' : ''}" type="button" data-tag="${escapeAttr(item.tag)}">
          <span class="rank-number">${index + 1}</span>
          <span class="rank-main">
            <strong>${escapeHtml(item.tag)}</strong>
            <small>${item.docCount} docs / ${item.count} quotes / ${item.totalConnections} tag edges</small>
          </span>
          <span class="rank-score">${item.bridgeScore}</span>
        </button>
      `;
    })
    .join('');

  els.bridgeRanking.querySelectorAll('[data-tag]').forEach(button => {
    button.addEventListener('click', () => {
      selectNode(`tag:${button.getAttribute('data-tag')}`);
    });
  });
}

function renderComparisonTagButtons(tags, className) {
  if (!tags.length) {
    return '<span class="empty-panel">None</span>';
  }
  return tags
    .map(
      tag =>
        `<button class="tag-pill ${className}" type="button" data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}</button>`,
    )
    .join('');
}

function renderDocumentComparison() {
  if (!els.comparisonPanel) {
    return;
  }
  const comparison = state.graph?.comparison;
  if (!state.documentComparisonEnabled || !comparison?.enabled) {
    els.comparisonPanel.innerHTML =
      '<div class="empty-panel">Enable document comparison and choose two documents.</div>';
    return;
  }

  els.comparisonPanel.innerHTML = `
    <div class="comparison-docs">
      <span class="doc-a">${escapeHtml(documentLabelByUri(comparison.documentA))}</span>
      <span class="doc-b">${escapeHtml(documentLabelByUri(comparison.documentB))}</span>
    </div>
    <div class="comparison-row">
      <strong>Shared</strong>
      <span>${comparison.shared.length}</span>
    </div>
    <div class="tag-chip-row comparison-tags">
      ${renderComparisonTagButtons(comparison.shared, 'tag-pill-shared')}
    </div>
    <div class="comparison-row">
      <strong>Only A</strong>
      <span>${comparison.onlyA.length}</span>
    </div>
    <div class="tag-chip-row comparison-tags">
      ${renderComparisonTagButtons(comparison.onlyA, 'tag-pill-a')}
    </div>
    <div class="comparison-row">
      <strong>Only B</strong>
      <span>${comparison.onlyB.length}</span>
    </div>
    <div class="tag-chip-row comparison-tags">
      ${renderComparisonTagButtons(comparison.onlyB, 'tag-pill-b')}
    </div>
  `;

  els.comparisonPanel.querySelectorAll('[data-tag]').forEach(button => {
    button.addEventListener('click', () => {
      selectNode(`tag:${button.getAttribute('data-tag')}`);
    });
  });
}

function renderEdgeList() {
  const edges = state.edits?.tagEdges || [];
  if (!edges.length) {
    els.edgeList.innerHTML =
      '<div class="empty-panel">No human tag edges yet.</div>';
    return;
  }

  els.edgeList.replaceChildren();
  for (const edge of edges) {
    const isVisible =
      state.graph.visibleTags.has(edge.sourceTag) &&
      state.graph.visibleTags.has(edge.targetTag);
    const item = document.createElement('div');
    item.className = `edge-item ${isVisible ? '' : 'hidden-edge'}`;
    item.innerHTML = `
      <div class="edge-tags">
        <span>${escapeHtml(edge.sourceTag)}</span>
        <span>${escapeHtml(edge.targetTag)}</span>
      </div>
      <input type="text" value="${escapeAttr(edgeDisplayLabel(edge))}" aria-label="Relationship" />
      <div class="edge-actions">
        <span>${isVisible ? (edge.createdFrom === 'implicit' ? 'Promoted suggestion' : 'Visible') : 'Hidden until both tags exist'}</span>
        <button class="ghost-button danger" type="button">Delete</button>
      </div>
    `;
    const input = item.querySelector('input');
    const deleteButton = item.querySelector('button');
    input.addEventListener('change', () => {
      edge.connectionType = input.value.trim();
      edge.label = edge.connectionType;
      edge.updatedAt = new Date().toISOString();
      saveEditsNow();
      buildGraph();
      renderGraph();
    });
    deleteButton.addEventListener('click', () => deleteCreatedEdge(edge.id));
    els.edgeList.append(item);
  }
}

function populateEdgeSelects() {
  const tags = state.graph?.tagNodes.map(node => node.tag) || [];
  for (const select of [els.edgeSource, els.edgeTarget]) {
    select.replaceChildren();
    for (const tag of tags) {
      const option = document.createElement('option');
      option.value = tag;
      option.textContent = tag;
      select.append(option);
    }
  }
}

function openEdgeEditor({
  sourceTag = '',
  targetTag = '',
  implicitEdge = null,
  editEdge = null,
} = {}) {
  populateEdgeSelects();
  state.edgeDraft = editEdge
    ? { editingEdgeId: editEdge.id }
    : implicitEdge
      ? { implicitEdge }
      : null;
  els.edgeEditorTitle.textContent = editEdge ? 'Edit Tag Edge' : 'Add Tag Edge';
  els.saveEdgeBtn.textContent = editEdge ? 'Save Changes' : 'Save Edge';
  els.edgeSource.value =
    editEdge?.sourceTag || sourceTag || els.edgeSource.value;
  els.edgeTarget.value =
    editEdge?.targetTag || targetTag || els.edgeTarget.value;
  els.edgeLabel.value = editEdge ? edgeDisplayLabel(editEdge) : '';
  if (implicitEdge) {
    els.edgeContext.hidden = false;
    els.edgeContext.textContent = implicitEdgeSummary(implicitEdge);
  } else {
    els.edgeContext.hidden = true;
    els.edgeContext.textContent = '';
  }
  if (typeof els.edgeEditor.showModal === 'function') {
    els.edgeEditor.showModal();
  } else {
    els.edgeEditor.setAttribute('open', '');
  }
}

function closeEdgeEditor() {
  state.edgeDraft = null;
  els.edgeEditorTitle.textContent = 'Add Tag Edge';
  els.saveEdgeBtn.textContent = 'Save Edge';
  if (typeof els.edgeEditor.close === 'function') {
    els.edgeEditor.close();
  } else {
    els.edgeEditor.removeAttribute('open');
  }
}

function saveNewEdge() {
  const sourceTag = els.edgeSource.value;
  const targetTag = els.edgeTarget.value;
  const connectionType = els.edgeLabel.value.trim();
  const editingEdgeId = state.edgeDraft?.editingEdgeId || null;
  if (!sourceTag || !targetTag || sourceTag === targetTag) {
    showNotice('Choose two different tags before saving the edge.');
    return;
  }
  if (edgePairExists(sourceTag, targetTag, { ignoreEdgeId: editingEdgeId })) {
    showNotice('That tag connection already exists.');
    return;
  }

  showNotice('');
  const now = new Date().toISOString();
  if (editingEdgeId) {
    const edge = createdEdgeById(editingEdgeId);
    if (!edge) {
      showNotice('That edge no longer exists.');
      closeEdgeEditor();
      buildGraph();
      renderGraph();
      return;
    }
    edge.sourceTag = sourceTag;
    edge.targetTag = targetTag;
    edge.connectionType = connectionType;
    edge.label = connectionType;
    edge.updatedAt = now;
    closeEdgeEditor();
    saveEditsNow();
    buildGraph();
    renderGraph();
    return;
  }

  const promotedImplicit = state.edgeDraft?.implicitEdge || null;
  const edge = {
    id: `edge:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    sourceTag,
    targetTag,
    connectionType,
    label: connectionType,
    createdAt: now,
    updatedAt: now,
    createdBy: 'human',
    createdFrom: promotedImplicit ? 'implicit' : 'manual',
  };
  if (promotedImplicit) {
    edge.provenance = {
      promotedFrom: promotedImplicit.id,
      generator: promotedImplicit.generator,
      evidence: promotedImplicit.evidence,
    };
  }
  state.edits.tagEdges.push(edge);
  closeEdgeEditor();
  saveEditsNow();
  buildGraph();
  renderGraph();
}

function scheduleSave() {
  setSaveState('Saving');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveEditsNow, 350);
}

async function saveEditsNow() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  setSaveState('Saving');
  try {
    state.edits = await api('/api/edits', {
      method: 'PUT',
      body: state.edits,
    });
    setSaveState('Saved');
  } catch (err) {
    setSaveState('Save failed');
    showNotice(err.message);
  }
}

async function login() {
  showNotice('');
  debugAuth('login.started', { origin: window.location.origin });
  const popup = window.open(
    'about:blank',
    'Hypothesis Login',
    'width=475,height=630',
  );
  if (!popup) {
    debugAuth('login.popup_blocked');
    showNotice('The login popup was blocked.');
    return;
  }
  debugAuth('login.popup_opened');

  let authStart;
  try {
    authStart = await api('/api/oauth/start');
  } catch (err) {
    debugAuth('login.start_error', { message: err.message });
    popup.close();
    throw err;
  }

  const { authUrl, state: oauthState, origin: oauthOrigin } = authStart;
  debugAuth('login.auth_url_loaded', {
    oauthOrigin,
    state: oauthState,
  });
  const code = await new Promise((resolve, reject) => {
    let settled = false;
    let timeout = null;

    function cleanup() {
      clearTimeout(timeout);
      window.removeEventListener('message', listener);
    }

    function finish(callback, value) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback(value);
    }

    timeout = setTimeout(() => {
      debugAuth('login.timeout', { state: oauthState });
      finish(reject, new Error('Login timed out.'));
    }, 180_000);

    function listener(event) {
      const data =
        event.data && typeof event.data === 'object' ? event.data : null;
      debugAuth('login.message_received', {
        origin: event.origin,
        sourceMatchesPopup: event.source === popup,
        dataType: typeof event.data,
        messageType: data?.type || null,
        state: data?.state || null,
        stateMatches: data?.state === oauthState,
        keys: data ? Object.keys(data) : [],
        hasCode: Boolean(data?.code),
      });

      if (!data || data.state !== oauthState) {
        return;
      }
      if (data.type === 'authorization_response') {
        finish(resolve, data.code);
      } else if (data.type === 'authorization_canceled') {
        finish(reject, new Error('Login was canceled.'));
      }
    }

    window.addEventListener('message', listener);
    popup.location.href = authUrl;
    debugAuth('login.popup_navigated', { state: oauthState });
  });

  debugAuth('login.code_received', {
    hasCode: Boolean(code),
    state: oauthState,
  });
  try {
    state.session = await api('/api/oauth/exchange', {
      method: 'POST',
      body: { code, state: oauthState },
    });
  } catch (err) {
    debugAuth('login.exchange_error', { message: err.message });
    throw err;
  }
  debugAuth('login.exchange_completed', {
    authenticated: Boolean(state.session?.authenticated),
    userid: state.session?.profile?.userid || null,
  });
  updateControls();

  if (!state.session?.authenticated) {
    showNotice('Login returned, but the profile request did not authenticate.');
    return;
  }

  try {
    await loadGroups();
  } catch (err) {
    state.groups = [];
    updateGroupSelect();
    showNotice(`Signed in, but groups did not load: ${err.message}`);
    debugAuth('groups.load_error', { message: err.message });
  }
  updateControls();
}

async function logout() {
  await api('/api/logout', { method: 'POST' });
  state.session = { authenticated: false, profile: null };
  state.groups = [];
  updateControls();
}

async function loadStatus() {
  state.session = await api('/api/status');
  updateControls();
}

async function loadGroups() {
  if (!state.session?.authenticated) {
    return;
  }
  state.groups = await api('/api/groups');
  debugAuth('groups.loaded', { count: state.groups.length });
  updateGroupSelect();
}

async function loadGraph() {
  const { snapshot, edits } = await api('/api/graph');
  state.snapshot = snapshot;
  state.edits = edits;
  ensureCurrentLayout();
  updateGroupSelect();
  updateDocumentSelect();
  updateColorFocusSelect();
  updateComparisonSelects();
  buildGraph();
  renderGraph();
  updateGraphHeader();
  updateControls();
}

async function refreshSnapshot() {
  const groupId = els.groupSelect.value;
  const group = state.groups.find(item => item.id === groupId);
  if (!groupId) {
    showNotice('Choose a group first.');
    return;
  }

  showNotice('');
  els.refreshBtn.disabled = true;
  els.graphStats.textContent = 'Refreshing annotations...';
  try {
    state.snapshot = await api('/api/refresh', {
      method: 'POST',
      body: { groupId, group },
    });
    const { edits } = await api('/api/graph');
    state.edits = edits;
    ensureCurrentLayout();
    updateDocumentSelect();
    updateColorFocusSelect();
    updateComparisonSelects();
    buildGraph();
    renderGraph();
    updateGraphHeader();
  } catch (err) {
    showNotice(err.message);
  } finally {
    updateControls();
  }
}

function updateGroupSelect() {
  const current =
    state.edits?.selectedGroupId ||
    state.snapshot?.source?.group?.id ||
    els.groupSelect.value;
  els.groupSelect.replaceChildren();
  if (!state.groups.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = state.session?.authenticated
      ? 'No groups found'
      : 'Log in first';
    els.groupSelect.append(option);
    return;
  }

  for (const group of state.groups) {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = group.organization
      ? `${group.name} (${group.organization})`
      : group.name;
    els.groupSelect.append(option);
  }
  if (current && state.groups.some(group => group.id === current)) {
    els.groupSelect.value = current;
  }
}

function updateDocumentSelect() {
  const options = documentOptions();
  const current = state.documentFilter;

  els.documentSelect.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = options.length
    ? `All Documents (${options.length})`
    : 'All Documents';
  els.documentSelect.append(allOption);

  for (const option of options) {
    const item = document.createElement('option');
    item.value = option.uri;
    item.textContent = `${option.label} (${option.count})`;
    els.documentSelect.append(item);
  }

  if (current !== 'all' && options.some(option => option.uri === current)) {
    els.documentSelect.value = current;
  } else {
    state.documentFilter = 'all';
    els.documentSelect.value = 'all';
  }
  updateComparisonSelects();
}

function updateColorFocusSelect() {
  const options = documentOptions();
  const current = state.colorFocus;

  els.colorFocusSelect.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All documents';
  els.colorFocusSelect.append(allOption);

  for (const option of options) {
    const item = document.createElement('option');
    item.value = option.uri;
    item.textContent = option.label;
    els.colorFocusSelect.append(item);
  }

  if (current !== 'all' && options.some(option => option.uri === current)) {
    els.colorFocusSelect.value = current;
  } else {
    state.colorFocus = 'all';
    els.colorFocusSelect.value = 'all';
  }
}

function updateComparisonSelects() {
  const options = documentOptions();
  const validUris = new Set(options.map(option => option.uri));

  if (!validUris.has(state.compareDocumentA)) {
    state.compareDocumentA = options[0]?.uri || '';
  }
  if (
    !validUris.has(state.compareDocumentB) ||
    state.compareDocumentB === state.compareDocumentA
  ) {
    state.compareDocumentB =
      options.find(option => option.uri !== state.compareDocumentA)?.uri || '';
  }

  for (const [select, current] of [
    [els.compareDocASelect, state.compareDocumentA],
    [els.compareDocBSelect, state.compareDocumentB],
  ]) {
    select.replaceChildren();
    for (const option of options) {
      const item = document.createElement('option');
      item.value = option.uri;
      item.textContent = option.label;
      select.append(item);
    }
    select.value = current;
  }
}

function updateControls() {
  const authenticated = Boolean(state.session?.authenticated);
  const tokenAuth = state.session?.authMethod === 'apiToken';
  els.sessionLabel.textContent = authenticated
    ? tokenAuth
      ? `API token: ${state.session.profile?.displayName || state.session.profile?.userid}`
      : `Signed in as ${state.session.profile?.displayName || state.session.profile?.userid}`
    : 'Not signed in';
  els.loginBtn.textContent = tokenAuth
    ? 'API token'
    : authenticated
      ? 'Log out'
      : 'Log in';
  els.loginBtn.disabled = tokenAuth;
  els.groupSelect.disabled = !authenticated || !state.groups.length;
  els.documentSelect.disabled = !state.snapshot?.annotations?.length;
  els.colorModeSelect.disabled = !state.graph;
  els.colorFocusSelect.disabled =
    !state.graph || state.colorMode !== 'document';
  els.colorModeSelect.value = state.colorMode;
  els.colorFocusSelect.value = state.colorFocus;
  els.tagOnlyToggle.disabled = !state.graph;
  els.edgeEvidenceToggle.disabled = !state.graph;
  els.edgeHumanToggle.disabled = !state.graph;
  els.edgeImplicitToggle.disabled = !state.graph;
  els.documentComparisonToggle.disabled =
    !state.graph || documentOptions().length < 2;
  els.compareDocASelect.disabled =
    !state.graph || !state.documentComparisonEnabled;
  els.compareDocBSelect.disabled =
    !state.graph || !state.documentComparisonEnabled;
  els.tagOnlyToggle.checked = !state.showQuotes;
  els.edgeEvidenceToggle.checked = state.edgeFilters.evidence;
  els.edgeHumanToggle.checked = state.edgeFilters.human;
  els.edgeImplicitToggle.checked = state.showImplicitConnections;
  els.documentComparisonToggle.checked = state.documentComparisonEnabled;
  els.compareDocASelect.value = state.compareDocumentA;
  els.compareDocBSelect.value = state.compareDocumentB;
  els.refreshBtn.disabled = !authenticated || !els.groupSelect.value;
  els.newTagBtn.disabled = !state.edits;
  els.newEdgeBtn.disabled = !state.graph?.tagNodes.length;
  els.zoomOutBtn.disabled = !state.graph;
  els.zoomInBtn.disabled = !state.graph;
  els.fitBtn.disabled = !state.graph;
  els.resetLayoutBtn.disabled = !state.graph;
}

function updateGraphHeader() {
  const snapshot = state.snapshot || {};
  const groupName = snapshot.source?.group?.name || 'No snapshot loaded';
  const refreshed = snapshot.refreshedAt
    ? formatDate(snapshot.refreshedAt)
    : 'Never';
  const tags = state.graph?.tagNodes.length || 0;
  const quotes = state.graph?.quoteNodes.length || 0;
  const humanEdges = state.graph?.humanEdges.length || 0;
  const implicitEdges = state.graph?.implicitEdges.length || 0;
  const implicitText = state.showImplicitConnections
    ? ` / ${implicitEdges} suggested tag-tag edges`
    : '';
  els.graphTitle.textContent = groupName;
  els.graphStats.textContent = `${selectedDocumentLabel()}: ${tags} tags / ${quotes} quotes / ${humanEdges} manual tag-tag edges${implicitText}. Refreshed ${refreshed}.`;
}

function formatDate(value) {
  if (!value) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

async function init() {
  els.loginBtn.addEventListener('click', () => {
    if (state.session?.authenticated) {
      logout().catch(err => showNotice(err.message));
    } else {
      login().catch(err => showNotice(err.message));
    }
  });
  els.refreshBtn.addEventListener('click', () => {
    refreshSnapshot().catch(err => showNotice(err.message));
  });
  els.newTagBtn.addEventListener('click', () => openTagEditor());
  els.newEdgeBtn.addEventListener('click', openEdgeEditor);
  els.cancelEdgeBtn.addEventListener('click', closeEdgeEditor);
  els.saveEdgeBtn.addEventListener('click', saveNewEdge);
  els.cancelTagBtn.addEventListener('click', closeTagEditor);
  els.saveTagBtn.addEventListener('click', saveDescriptiveTag);
  els.tagName.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveDescriptiveTag();
    }
  });
  els.zoomOutBtn.addEventListener('click', () => {
    setZoom(state.zoom - ZOOM_STEP);
  });
  els.zoomInBtn.addEventListener('click', () => {
    setZoom(state.zoom + ZOOM_STEP);
  });
  els.fitBtn.addEventListener('click', () => {
    state.userZoomed = true;
    fitGraphToWidth();
  });
  els.resetLayoutBtn.addEventListener('click', () => {
    resetLayout();
  });
  els.groupSelect.addEventListener('change', () => {
    state.edits.selectedGroupId = els.groupSelect.value || null;
    saveEditsNow().catch(err => showNotice(err.message));
  });
  els.colorModeSelect.addEventListener('change', () => {
    state.colorMode = els.colorModeSelect.value || 'tag';
    if (state.colorMode !== 'document') {
      state.colorFocus = 'all';
    }
    updateColorFocusSelect();
    renderGraph();
    updateControls();
  });
  els.colorFocusSelect.addEventListener('change', () => {
    state.colorFocus = els.colorFocusSelect.value || 'all';
    renderGraph();
    updateControls();
  });
  els.tagOnlyToggle.addEventListener('change', () => {
    state.showQuotes = !els.tagOnlyToggle.checked;
    state.userZoomed = false;
    buildGraph();
    renderGraph();
    updateControls();
  });
  els.edgeEvidenceToggle.addEventListener('change', () => {
    state.edgeFilters.evidence = els.edgeEvidenceToggle.checked;
    renderGraph();
    updateControls();
  });
  els.edgeHumanToggle.addEventListener('change', () => {
    state.edgeFilters.human = els.edgeHumanToggle.checked;
    renderGraph();
    updateControls();
  });
  els.edgeImplicitToggle.addEventListener('change', () => {
    state.showImplicitConnections = els.edgeImplicitToggle.checked;
    state.edgeFilters.implicit = state.showImplicitConnections;
    renderGraph();
    updateControls();
  });
  els.documentComparisonToggle.addEventListener('change', () => {
    state.documentComparisonEnabled = els.documentComparisonToggle.checked;
    buildGraph();
    renderGraph();
    updateControls();
  });
  els.compareDocASelect.addEventListener('change', () => {
    state.compareDocumentA = els.compareDocASelect.value;
    updateComparisonSelects();
    buildGraph();
    renderGraph();
    updateControls();
  });
  els.compareDocBSelect.addEventListener('change', () => {
    state.compareDocumentB = els.compareDocBSelect.value;
    updateComparisonSelects();
    buildGraph();
    renderGraph();
    updateControls();
  });
  els.documentSelect.addEventListener('change', () => {
    state.documentFilter = els.documentSelect.value || 'all';
    buildGraph();
    updateColorFocusSelect();
    updateComparisonSelects();
    if (
      state.selectedNodeId &&
      !state.graph.nodeById.has(state.selectedNodeId)
    ) {
      state.selectedNodeId = null;
    }
    renderGraph();
    updateGraphHeader();
    updateControls();
  });
  els.svg.addEventListener('pointermove', handleDrag);
  els.svg.addEventListener('pointerup', stopDrag);
  els.svg.addEventListener('pointerleave', stopDrag);
  window.addEventListener('resize', () => {
    if (!state.userZoomed) {
      maybeFitGraph();
    }
  });

  try {
    await loadStatus();
    await loadGroups();
    await loadGraph();
  } catch (err) {
    showNotice(err.message);
  }
}

init();
