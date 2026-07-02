export const NODE_LINK_STATE_KIND = 'hypothesis-node-link-state';
export const NODE_LINK_STATE_SCHEMA_VERSION = 1;
export const NODE_LINK_STATE_TAG = 'node-link-state';
export const NODE_LINK_STATE_VERSION_TAG = 'node-link-state:v1';
export const NODE_LINK_STATE_TAGS = [
  NODE_LINK_STATE_TAG,
  NODE_LINK_STATE_VERSION_TAG,
];

const DEFAULT_LAYOUT_VERSION = 2;

function cleanString(value) {
  return String(value || '').trim();
}

function cleanStringOrNull(value) {
  const text = cleanString(value);
  return text || null;
}

function cleanDateString(value) {
  const text = cleanString(value);
  return text || new Date().toISOString();
}

function cleanLayout(layout = {}) {
  const nodes = {};
  for (const [id, position] of Object.entries(layout.nodes || {})) {
    const x = Number(position?.x);
    const y = Number(position?.y);
    if (!id || !Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    nodes[id] = { x, y };
  }

  return {
    version: Number(layout.version) || DEFAULT_LAYOUT_VERSION,
    nodes,
  };
}

function cleanDescriptiveTags(tags = []) {
  const seen = new Set();
  const result = [];

  for (const item of tags) {
    const tag = cleanString(item?.tag);
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    result.push({
      id:
        cleanString(item?.id) ||
        `desc:${globalThis.crypto?.randomUUID?.() || tag}`,
      tag,
      createdAt: cleanDateString(item?.createdAt),
      updatedAt: item?.updatedAt ? cleanDateString(item.updatedAt) : undefined,
      createdBy: cleanString(item?.createdBy) || 'human',
    });
  }

  return result;
}

function edgeKey(sourceTag, targetTag) {
  return `${sourceTag}\n${targetTag}`;
}

function cleanTagEdges(edges = []) {
  const seen = new Set();
  const result = [];

  for (const item of edges) {
    const sourceTag = cleanString(item?.sourceTag);
    const targetTag = cleanString(item?.targetTag);
    const relationship = cleanString(item?.connectionType || item?.label);
    if (!sourceTag || !targetTag || !relationship) {
      continue;
    }

    const key = edgeKey(sourceTag, targetTag);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    result.push({
      id:
        cleanString(item?.id) ||
        `edge:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      sourceTag,
      targetTag,
      connectionType: relationship,
      label: relationship,
      createdAt: cleanDateString(item?.createdAt),
      updatedAt: cleanDateString(item?.updatedAt),
      createdBy: cleanString(item?.createdBy) || 'human',
      createdFrom: cleanString(item?.createdFrom) || 'manual',
    });
  }

  return result;
}

export function emptyGraphEdits(overrides = {}) {
  return normalizeGraphEdits({
    schemaVersion: NODE_LINK_STATE_SCHEMA_VERSION,
    updatedAt: null,
    selectedGroupId: null,
    layout: {
      version: DEFAULT_LAYOUT_VERSION,
      nodes: {},
    },
    descriptiveTags: [],
    tagEdges: [],
    ...overrides,
  });
}

export function normalizeGraphEdits(raw = {}, options = {}) {
  const selectedGroupId =
    cleanStringOrNull(options.selectedGroupId) ||
    cleanStringOrNull(raw.selectedGroupId);
  const updatedAt =
    options.updatedAt === null
      ? null
      : cleanStringOrNull(options.updatedAt) ||
        cleanStringOrNull(raw.updatedAt);

  return {
    schemaVersion: NODE_LINK_STATE_SCHEMA_VERSION,
    updatedAt,
    selectedGroupId,
    layout: cleanLayout(raw.layout),
    descriptiveTags: cleanDescriptiveTags(raw.descriptiveTags),
    tagEdges: cleanTagEdges(raw.tagEdges),
  };
}

export function createHypothesisStatePayload(edits, options = {}) {
  const updatedAt = options.updatedAt || new Date().toISOString();
  const normalized = normalizeGraphEdits(edits, {
    selectedGroupId: options.groupId || edits?.selectedGroupId,
    updatedAt,
  });

  return {
    kind: NODE_LINK_STATE_KIND,
    schemaVersion: NODE_LINK_STATE_SCHEMA_VERSION,
    groupId: normalized.selectedGroupId,
    stateUri: options.stateUri || null,
    updatedAt,
    // Hypothesis stores only semantic graph data. Layout is intentionally
    // regenerated locally so the state annotation remains portable and small.
    edits: {
      descriptiveTags: normalized.descriptiveTags,
      tagEdges: normalized.tagEdges,
    },
  };
}

export function serializeHypothesisState(payload) {
  return JSON.stringify(payload, null, 2);
}

function unwrapFencedJson(text) {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

export function parseHypothesisStateText(text) {
  const payload = JSON.parse(unwrapFencedJson(text));
  if (
    payload?.kind !== NODE_LINK_STATE_KIND ||
    payload?.schemaVersion !== NODE_LINK_STATE_SCHEMA_VERSION
  ) {
    throw new Error('Annotation is not a supported node-link state payload.');
  }
  return payload;
}

export function editsFromHypothesisStatePayload(payload, options = {}) {
  if (
    payload?.kind !== NODE_LINK_STATE_KIND ||
    payload?.schemaVersion !== NODE_LINK_STATE_SCHEMA_VERSION
  ) {
    throw new Error('Annotation is not a supported node-link state payload.');
  }

  const semanticEdits = {
    descriptiveTags: payload.edits?.descriptiveTags || [],
    tagEdges: payload.edits?.tagEdges || [],
  };

  return normalizeGraphEdits(semanticEdits, {
    selectedGroupId: options.groupId || payload.groupId,
    updatedAt: payload.updatedAt,
  });
}

export function isNodeLinkStateAnnotation(annotation) {
  const tags = new Set(annotation?.tags || []);
  return (
    tags.has(NODE_LINK_STATE_TAG) ||
    tags.has(NODE_LINK_STATE_VERSION_TAG) ||
    annotation?.text?.includes(`"kind": "${NODE_LINK_STATE_KIND}"`)
  );
}

export function tagLegendText(edits = {}) {
  const outgoing = new Map();
  const incoming = new Map();
  const tags = new Set();

  for (const edge of normalizeGraphEdits(edits).tagEdges) {
    tags.add(edge.sourceTag);
    tags.add(edge.targetTag);
    const outgoingList = outgoing.get(edge.sourceTag) || [];
    outgoingList.push(edge);
    outgoing.set(edge.sourceTag, outgoingList);
    const incomingList = incoming.get(edge.targetTag) || [];
    incomingList.push(edge);
    incoming.set(edge.targetTag, incomingList);
  }

  if (!tags.size) {
    return 'No manual tag-tag relationships.';
  }

  const lines = [];
  for (const tag of [...tags].sort((a, b) => a.localeCompare(b))) {
    lines.push(tag);
    const edges = (outgoing.get(tag) || []).sort((a, b) =>
      a.targetTag.localeCompare(b.targetTag),
    );
    for (const edge of edges) {
      lines.push(`   ${edge.connectionType} ${edge.targetTag}`);
    }
    const incomingEdges = (incoming.get(tag) || []).sort((a, b) =>
      a.sourceTag.localeCompare(b.sourceTag),
    );
    if (incomingEdges.length) {
      lines.push('   --- incoming relationships ---');
      for (const edge of incomingEdges) {
        lines.push(
          `   ${edge.sourceTag} ${edge.connectionType} ${edge.targetTag}`,
        );
      }
    }
  }

  return `${lines.join('\n')}\n`;
}
