export const SYSTEM_TAGS = new Set(['ai-pending', 'ai-user-approved']);

const IMPLICIT_GENERATORS = {
  coDocument: {
    id: 'co-document/v1',
    label: 'Same document',
    kind: 'co-document',
  },
};

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

export function graphLayersForView({
  showQuotes = true,
  showImplicitConnections = false,
  selectionFirstEdges = true,
} = {}) {
  return {
    showQuoteNodes: Boolean(showQuotes),
    showAutoEdges: Boolean(showQuotes),
    showImplicitEdges: Boolean(showImplicitConnections),
    selectionFirstEdges: Boolean(selectionFirstEdges),
  };
}

export function edgeDisplayLabel(edge) {
  return edge.connectionType || edge.label || edge.generator?.label || '';
}

export function edgeDisplayPurpose(edge) {
  return edge.purpose || edge.explanation || '';
}
