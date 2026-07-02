import type { Annotation } from '../../types/api';
import { contentTags, isNodeLinkStateAnnotation } from './graph-state';
import type { ManualTagEdge, NodeLinkSemanticState } from './graph-state';

export type NodeLinkDocument = {
  uri: string;
  label: string;
  quoteCount: number;
};

export type NodeLinkQuote = {
  id: string;
  annotation: Annotation;
  quote: string;
  tags: string[];
  documentUri: string;
  documentLabel: string;
  sourceUrl: string;
};

export type NodeLinkTagNode = {
  id: string;
  tag: string;
  quoteCount: number;
  documentCount: number;
  documentUris: string[];
  descriptive: boolean;
};

export type NodeLinkGraph = {
  tags: NodeLinkTagNode[];
  quotes: NodeLinkQuote[];
  documents: NodeLinkDocument[];
  manualEdges: ManualTagEdge[];
  annotationCount: number;
};

export type TagLayoutNode = NodeLinkTagNode & {
  x: number;
  y: number;
  color: string;
};

export type TagGraphLayout = {
  width: number;
  height: number;
  nodes: TagLayoutNode[];
};

function compactText(text: string, maxLength = 80) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

export function documentLabelFromUrl(uri: string) {
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

export function annotationDocumentLabel(annotation: Annotation) {
  const rawTitle = annotation.document?.title;
  const title = Array.isArray(rawTitle) ? rawTitle[0] : rawTitle;
  if (title && title !== annotation.uri) {
    return compactText(String(title), 54);
  }
  return compactText(documentLabelFromUrl(annotation.uri), 54);
}

export function annotationQuote(annotation: Annotation) {
  for (const target of annotation.target || []) {
    for (const selector of target.selector || []) {
      if (selector.type === 'TextQuoteSelector') {
        return compactText(selector.exact, 220);
      }
    }
    if (target.description) {
      return compactText(target.description, 220);
    }
  }
  return '';
}

function sourceUrl(annotation: Annotation) {
  return (
    annotation.links?.incontext || annotation.links?.html || annotation.uri
  );
}

function isEvidenceAnnotation(annotation: Annotation) {
  if (
    annotation.hidden ||
    annotation.references?.length ||
    isNodeLinkStateAnnotation(annotation)
  ) {
    return false;
  }
  return contentTags(annotation.tags || []).length > 0;
}

export function buildNodeLinkGraph(
  annotations: Annotation[],
  semanticState: NodeLinkSemanticState,
): NodeLinkGraph {
  const tagMap = new Map<
    string,
    {
      quoteCount: number;
      documentUris: Set<string>;
      descriptive: boolean;
    }
  >();
  const documentMap = new Map<string, NodeLinkDocument>();
  const quotes: NodeLinkQuote[] = [];

  for (const annotation of annotations.filter(isEvidenceAnnotation)) {
    const tags = contentTags(annotation.tags || []);
    const quote = annotationQuote(annotation);
    const documentUri = annotation.uri || '';
    const documentLabel = annotationDocumentLabel(annotation);

    if (quote && documentUri) {
      const documentItem = documentMap.get(documentUri) || {
        uri: documentUri,
        label: documentLabel,
        quoteCount: 0,
      };
      documentItem.quoteCount += 1;
      documentMap.set(documentUri, documentItem);
    }

    for (const tag of tags) {
      const item = tagMap.get(tag) || {
        quoteCount: 0,
        documentUris: new Set<string>(),
        descriptive: false,
      };
      if (quote) {
        item.quoteCount += 1;
      }
      if (documentUri) {
        item.documentUris.add(documentUri);
      }
      tagMap.set(tag, item);
    }

    if (quote) {
      quotes.push({
        id: `quote:${annotation.id || quotes.length}`,
        annotation,
        quote,
        tags,
        documentUri,
        documentLabel,
        sourceUrl: sourceUrl(annotation),
      });
    }
  }

  for (const item of semanticState.descriptiveTags) {
    if (!item.tag || tagMap.has(item.tag)) {
      continue;
    }
    tagMap.set(item.tag, {
      quoteCount: 0,
      documentUris: new Set(),
      descriptive: true,
    });
  }

  const tags = [...tagMap.entries()]
    .map(([tag, value]) => ({
      id: `tag:${tag}`,
      tag,
      quoteCount: value.quoteCount,
      documentCount: value.documentUris.size,
      documentUris: [...value.documentUris].sort((a, b) => a.localeCompare(b)),
      descriptive: value.descriptive,
    }))
    .sort(
      (a, b) =>
        b.quoteCount - a.quoteCount ||
        b.documentCount - a.documentCount ||
        a.tag.localeCompare(b.tag),
    );

  const visibleTags = new Set(tags.map(tag => tag.tag));
  const manualEdges = semanticState.tagEdges
    .filter(
      edge =>
        visibleTags.has(edge.sourceTag) && visibleTags.has(edge.targetTag),
    )
    .sort(
      (a, b) =>
        a.sourceTag.localeCompare(b.sourceTag) ||
        a.targetTag.localeCompare(b.targetTag),
    );

  return {
    tags,
    quotes: quotes.sort(
      (a, b) =>
        a.documentLabel.localeCompare(b.documentLabel) ||
        a.quote.localeCompare(b.quote),
    ),
    documents: [...documentMap.values()].sort((a, b) =>
      a.label.localeCompare(b.label),
    ),
    manualEdges,
    annotationCount: annotations.filter(isEvidenceAnnotation).length,
  };
}

export function colorForTag(tag: string) {
  let hash = 0;
  for (let index = 0; index < tag.length; index += 1) {
    hash = (hash * 31 + tag.charCodeAt(index)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 52% 36%)`;
}

export function buildTagGraphLayout(graph: NodeLinkGraph): TagGraphLayout {
  const count = Math.max(1, graph.tags.length);
  const columns = Math.max(3, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(2, Math.ceil(count / columns));
  const width = Math.max(920, columns * 250 + 180);
  const height = Math.max(620, rows * 155 + 180);
  const cellWidth = width / columns;
  const cellHeight = (height - 120) / rows;

  const nodes = graph.tags.map((tag, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...tag,
      x: Math.round(cellWidth * col + cellWidth / 2),
      y: Math.round(100 + cellHeight * row + cellHeight / 2),
      color: colorForTag(tag.tag),
    };
  });

  return { width, height, nodes };
}
