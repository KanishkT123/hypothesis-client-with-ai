export const SYSTEM_TAGS = new Set(['ai-pending', 'ai-user-approved']);

const IMPLICIT_GENERATORS = {
  coDocument: {
    id: 'co-document/v1',
    label: 'Same document',
    kind: 'co-document',
  },
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function contentTags(tags = []) {
  const seen = new Set();
  const result = [];
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (!tag || SYSTEM_TAGS.has(tag) || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

export function annotationDocumentId(annotation) {
  return annotation?.uri || '';
}

export function documentLabelFromUrl(uri) {
  try {
    const url = new URL(uri);
    const file = url.pathname.split('/').filter(Boolean).pop();
    if (file) {
      return decodeURIComponent(file).replace(/[-_]+/g, ' ');
    }
    return url.hostname;
  } catch {
    return uri || 'Untitled document';
  }
}

export function annotationDocumentLabel(annotation) {
  const title = annotation?.documentTitle || '';
  if (title && title !== annotation?.uri) {
    return title;
  }
  return documentLabelFromUrl(annotationDocumentId(annotation));
}

export function documentOptionsForAnnotations(annotations = []) {
  const byUri = new Map();
  for (const ann of annotations) {
    if (ann.hidden || ann.isReply || !ann.quote) {
      continue;
    }
    const uri = annotationDocumentId(ann);
    if (!uri) {
      continue;
    }
    const option = byUri.get(uri) || {
      uri,
      label: annotationDocumentLabel(ann),
      count: 0,
    };
    option.count += 1;
    byUri.set(uri, option);
  }
  return [...byUri.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function normalizeTagPair(sourceTag, targetTag) {
  return [sourceTag, targetTag].sort((a, b) => a.localeCompare(b));
}

export function tagPairKey(sourceTag, targetTag) {
  return normalizeTagPair(sourceTag, targetTag).join('\u0000');
}

export function tagEdgePairKeys(tagEdges = []) {
  return new Set(
    tagEdges
      .filter(edge => edge.sourceTag && edge.targetTag)
      .map(edge => tagPairKey(edge.sourceTag, edge.targetTag)),
  );
}

/**
 * Build generated tag-tag suggestions.
 *
 * The current generator links tags that co-occur in at least one visible
 * document. The shape keeps generator metadata and evidence separate so a
 * later LLM generator can emit the same edge contract with different evidence.
 */
export function buildImplicitTagEdges({
  tagNodes = [],
  tagEdges = [],
  documentOptions = [],
} = {}) {
  const existingPairs = tagEdgePairKeys(tagEdges);
  const labelByDocument = new Map(
    documentOptions.map(option => [option.uri, option.label]),
  );
  const tagsByDocument = new Map();

  for (const node of tagNodes) {
    for (const uri of node.documentUris || []) {
      const tags = tagsByDocument.get(uri) || new Set();
      tags.add(node.tag);
      tagsByDocument.set(uri, tags);
    }
  }

  const evidenceByPair = new Map();
  for (const [uri, tags] of tagsByDocument.entries()) {
    const sortedTags = [...tags].sort((a, b) => a.localeCompare(b));
    for (let i = 0; i < sortedTags.length; i += 1) {
      for (let j = i + 1; j < sortedTags.length; j += 1) {
        const [sourceTag, targetTag] = normalizeTagPair(
          sortedTags[i],
          sortedTags[j],
        );
        const pairKey = tagPairKey(sourceTag, targetTag);
        if (existingPairs.has(pairKey)) {
          continue;
        }
        const evidence = evidenceByPair.get(pairKey) || {
          sourceTag,
          targetTag,
          documents: [],
        };
        evidence.documents.push({
          type: 'document',
          uri,
          label: labelByDocument.get(uri) || documentLabelFromUrl(uri),
        });
        evidenceByPair.set(pairKey, evidence);
      }
    }
  }

  return [...evidenceByPair.values()]
    .map(edge => {
      const evidence = edge.documents.sort((a, b) =>
        a.label.localeCompare(b.label),
      );
      const id = `implicit:${IMPLICIT_GENERATORS.coDocument.id}:${encodeURIComponent(
        tagPairKey(edge.sourceTag, edge.targetTag),
      )}`;
      return {
        id,
        type: 'implicit',
        sourceTag: edge.sourceTag,
        targetTag: edge.targetTag,
        source: `tag:${edge.sourceTag}`,
        target: `tag:${edge.targetTag}`,
        generator: IMPLICIT_GENERATORS.coDocument,
        evidence,
        documentUris: evidence.map(item => item.uri),
        documentLabels: evidence.map(item => item.label),
        evidenceCount: evidence.length,
      };
    })
    .sort(
      (a, b) =>
        b.evidenceCount - a.evidenceCount ||
        a.sourceTag.localeCompare(b.sourceTag) ||
        a.targetTag.localeCompare(b.targetTag),
    );
}

/**
 * Rank tags that are likely to bridge documents or authored tag-tag edges.
 * Higher scores favor tags with broader document coverage and more explicit or
 * suggested tag connections.
 */
export function buildBridgeRankings({
  tagNodes = [],
  humanEdges = [],
  implicitEdges = [],
} = {}) {
  const humanDegree = new Map();
  const implicitDegree = new Map();

  const addDegree = (map, edge) => {
    if (!edge.sourceTag || !edge.targetTag) {
      return;
    }
    map.set(edge.sourceTag, (map.get(edge.sourceTag) || 0) + 1);
    map.set(edge.targetTag, (map.get(edge.targetTag) || 0) + 1);
  };

  humanEdges.forEach(edge => addDegree(humanDegree, edge));
  implicitEdges.forEach(edge => addDegree(implicitDegree, edge));

  return tagNodes
    .map(node => {
      const docCount = node.docCount ?? (node.documentUris || []).length;
      const realConnections = humanDegree.get(node.tag) || 0;
      const suggestedConnections = implicitDegree.get(node.tag) || 0;
      const bridgeScore =
        docCount * 10 +
        Math.min(node.count || 0, 12) +
        realConnections * 4 +
        suggestedConnections * 1.5 +
        (docCount > 1 ? 8 : 0);
      return {
        tag: node.tag,
        count: node.count || 0,
        docCount,
        realConnections,
        suggestedConnections,
        totalConnections: realConnections + suggestedConnections,
        bridgeScore: Math.round(bridgeScore * 10) / 10,
      };
    })
    .sort(
      (a, b) =>
        b.bridgeScore - a.bridgeScore ||
        b.docCount - a.docCount ||
        b.totalConnections - a.totalConnections ||
        a.tag.localeCompare(b.tag),
    );
}

/**
 * Classify visible tags against two documents. The result feeds both the
 * inspector summary and the comparison color mode in the SVG renderer.
 */
export function buildDocumentComparison({
  tagNodes = [],
  documentA = '',
  documentB = '',
} = {}) {
  const enabled =
    Boolean(documentA) && Boolean(documentB) && documentA !== documentB;
  const result = {
    enabled,
    documentA,
    documentB,
    shared: [],
    onlyA: [],
    onlyB: [],
    either: [],
    neither: [],
  };

  if (!enabled) {
    return result;
  }

  for (const node of tagNodes) {
    const docs = new Set(node.documentUris || []);
    const inA = docs.has(documentA);
    const inB = docs.has(documentB);
    if (inA || inB) {
      result.either.push(node.tag);
    }
    if (inA && inB) {
      result.shared.push(node.tag);
    } else if (inA) {
      result.onlyA.push(node.tag);
    } else if (inB) {
      result.onlyB.push(node.tag);
    } else {
      result.neither.push(node.tag);
    }
  }

  for (const key of ['shared', 'onlyA', 'onlyB', 'either', 'neither']) {
    result[key].sort((a, b) => a.localeCompare(b));
  }
  return result;
}

export function graphLayersForView({
  showQuotes = true,
  showImplicitConnections = false,
  edgeFilters = {},
} = {}) {
  return {
    showQuoteNodes: Boolean(showQuotes),
    showAutoEdges: Boolean(showQuotes) && edgeFilters.evidence !== false,
    showEvidenceEdges: edgeFilters.evidence !== false,
    showHumanEdges: edgeFilters.human !== false,
    showImplicitEdges:
      Boolean(showImplicitConnections) && edgeFilters.implicit !== false,
  };
}

export function edgeDisplayLabel(edge) {
  return edge.connectionType || edge.label || edge.generator?.label || '';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function tagOnlyGraphSize(tagCount, { nodeWidth = 190 } = {}) {
  const columns = Math.max(3, Math.ceil(Math.sqrt(tagCount || 1)));
  const rows = Math.max(2, Math.ceil((tagCount || 1) / columns));
  return {
    width: Math.max(920, columns * (nodeWidth + 86) + 120),
    height: Math.max(660, rows * 180 + 160),
  };
}

/**
 * Compute a deterministic force-directed tag-only layout.
 *
 * This deliberately lives in the graph model instead of the renderer so future
 * layout sources, such as LLM-generated edge weights or user-pinned clusters,
 * can reuse the same contract.
 */
export function buildTagOnlyLayout({
  tagNodes = [],
  edges = [],
  savedPositions = {},
  nodeWidth = 190,
  nodeHeight = 56,
  focusedTag = null,
} = {}) {
  const { width, height } = tagOnlyGraphSize(tagNodes.length, { nodeWidth });
  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = Math.max(190, width * 0.34);
  const radiusY = Math.max(150, height * 0.32);
  const collisionRadius = Math.max(nodeWidth * 0.68, nodeHeight * 2);
  const minRectGapX = nodeWidth + 30;
  const minRectGapY = nodeHeight + 26;
  const nodeByTag = new Map(tagNodes.map(node => [node.tag, node]));
  const degree = new Map(tagNodes.map(node => [node.tag, 0]));
  const visibleEdges = edges.filter(
    edge => nodeByTag.has(edge.sourceTag) && nodeByTag.has(edge.targetTag),
  );

  for (const edge of visibleEdges) {
    degree.set(edge.sourceTag, (degree.get(edge.sourceTag) || 0) + 1);
    degree.set(edge.targetTag, (degree.get(edge.targetTag) || 0) + 1);
  }

  const focusedNeighborTags = new Set();
  if (focusedTag) {
    for (const edge of visibleEdges) {
      if (edge.sourceTag === focusedTag) {
        focusedNeighborTags.add(edge.targetTag);
      } else if (edge.targetTag === focusedTag) {
        focusedNeighborTags.add(edge.sourceTag);
      }
    }
  }

  const sortedTagNodes = [...tagNodes].sort(
    (a, b) =>
      (degree.get(b.tag) || 0) - (degree.get(a.tag) || 0) ||
      a.tag.localeCompare(b.tag),
  );
  const focusedNodes = focusedTag
    ? sortedTagNodes.filter(node => node.tag === focusedTag)
    : [];
  const neighborNodes = focusedTag
    ? sortedTagNodes.filter(node => focusedNeighborTags.has(node.tag))
    : [];
  const otherNodes = focusedTag
    ? sortedTagNodes.filter(
        node => node.tag !== focusedTag && !focusedNeighborTags.has(node.tag),
      )
    : sortedTagNodes;

  const ringPosition = (index, count, ringX, ringY, offset = 0) => {
    const angle = offset + (Math.PI * 2 * index) / Math.max(1, count);
    return {
      x: centerX + Math.cos(angle) * ringX,
      y: centerY + Math.sin(angle) * ringY,
    };
  };

  const nodes = [];
  for (const node of focusedNodes) {
    nodes.push({
      id: node.id,
      tag: node.tag,
      x: centerX,
      y: centerY,
      vx: 0,
      vy: 0,
      pinned: true,
    });
  }

  neighborNodes.forEach((node, index) => {
    const position = ringPosition(
      index,
      neighborNodes.length,
      Math.min(360, width * 0.25),
      Math.min(250, height * 0.24),
      -Math.PI / 2,
    );
    nodes.push({
      id: node.id,
      tag: node.tag,
      ...position,
      vx: 0,
      vy: 0,
      pinned: Boolean(focusedTag),
    });
  });

  otherNodes.forEach((node, index) => {
    const saved = focusedTag ? null : savedPositions[node.id];
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) {
      nodes.push({
        id: node.id,
        tag: node.tag,
        x: saved.x,
        y: saved.y,
        vx: 0,
        vy: 0,
        pinned: true,
      });
      return;
    }
    const count = otherNodes.length;
    const position = focusedTag
      ? ringPosition(index, count, radiusX, radiusY, Math.PI / 9)
      : (() => {
          const angle = index * GOLDEN_ANGLE;
          const ring = Math.sqrt((index + 1) / Math.max(1, tagNodes.length));
          return {
            x: centerX + Math.cos(angle) * radiusX * ring,
            y: centerY + Math.sin(angle) * radiusY * ring,
          };
        })();
    nodes.push({
      id: node.id,
      tag: node.tag,
      ...position,
      vx: 0,
      vy: 0,
      pinned: false,
    });
  });
  const layoutByTag = new Map(nodes.map(node => [node.tag, node]));

  for (let tick = 0; tick < 220; tick += 1) {
    const cooling = 1 - tick / 220;
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        const dx = b.x - a.x || 0.01;
        const dy = b.y - a.y || 0.01;
        const distanceSquared = Math.max(dx * dx + dy * dy, 80);
        const distance = Math.sqrt(distanceSquared);
        const repulsion = (7600 * cooling) / distanceSquared;
        const pushX = (dx / distance) * repulsion;
        const pushY = (dy / distance) * repulsion;
        if (!a.pinned) {
          a.vx -= pushX;
          a.vy -= pushY;
        }
        if (!b.pinned) {
          b.vx += pushX;
          b.vy += pushY;
        }

        const overlap = collisionRadius * 2 - distance;
        if (overlap > 0) {
          const collisionX = (dx / distance) * overlap * 0.035;
          const collisionY = (dy / distance) * overlap * 0.035;
          if (!a.pinned) {
            a.vx -= collisionX;
            a.vy -= collisionY;
          }
          if (!b.pinned) {
            b.vx += collisionX;
            b.vy += collisionY;
          }
        }

        const rectOverlapX = minRectGapX - Math.abs(dx);
        const rectOverlapY = minRectGapY - Math.abs(dy);
        if (rectOverlapX > 0 && rectOverlapY > 0) {
          const signX = dx >= 0 ? 1 : -1;
          const signY = dy >= 0 ? 1 : -1;
          if (rectOverlapX < rectOverlapY) {
            const push = rectOverlapX * 0.045;
            if (!a.pinned) {
              a.vx -= signX * push;
            }
            if (!b.pinned) {
              b.vx += signX * push;
            }
          } else {
            const push = rectOverlapY * 0.055;
            if (!a.pinned) {
              a.vy -= signY * push;
            }
            if (!b.pinned) {
              b.vy += signY * push;
            }
          }
        }
      }
    }

    for (const edge of visibleEdges) {
      const source = layoutByTag.get(edge.sourceTag);
      const target = layoutByTag.get(edge.targetTag);
      if (!source || !target) {
        continue;
      }
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const focusedEdge =
        focusedTag &&
        (edge.sourceTag === focusedTag || edge.targetTag === focusedTag);
      const desired = focusedEdge ? 220 : edge.type === 'human' ? 250 : 390;
      const strength = focusedEdge
        ? 0.032
        : edge.type === 'human'
          ? 0.012
          : 0.0025;
      const pull = (distance - desired) * strength * cooling;
      const pullX = (dx / distance) * pull;
      const pullY = (dy / distance) * pull;
      if (!source.pinned) {
        source.vx += pullX;
        source.vy += pullY;
      }
      if (!target.pinned) {
        target.vx -= pullX;
        target.vy -= pullY;
      }
    }

    for (const node of nodes) {
      if (node.pinned) {
        continue;
      }
      node.vx += (centerX - node.x) * 0.0025;
      node.vy += (centerY - node.y) * 0.0025;
      node.vx *= 0.82;
      node.vy *= 0.82;
      node.x = clamp(
        node.x + node.vx,
        nodeWidth / 2 + 42,
        width - nodeWidth / 2 - 42,
      );
      node.y = clamp(
        node.y + node.vy,
        nodeHeight / 2 + 58,
        height - nodeHeight / 2 - 42,
      );
    }
  }

  return {
    width,
    height,
    positions: Object.fromEntries(
      nodes.map(node => [
        node.id,
        { x: Math.round(node.x), y: Math.round(node.y) },
      ]),
    ),
  };
}
