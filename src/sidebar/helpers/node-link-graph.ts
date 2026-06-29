import type { SavedAnnotation } from '../../types/api';
import {
  description as annotationDescription,
  isReply,
  quote as annotationQuote,
} from './annotation-metadata';

const SYSTEM_TAGS = new Set(['ai-pending', 'ai-user-approved']);

export type NodeLinkTagNode = {
  id: string;
  kind: 'tag';
  tag: string;
  annotationIds: string[];
};

export type NodeLinkQuoteNode = {
  id: string;
  kind: 'quote';
  annotationId: string;
  quote: string;
  tags: string[];
};

export type NodeLinkEdge = {
  id: string;
  source: string;
  target: string;
  annotationId: string;
  tag: string;
};

export type NodeLinkGraph = {
  tagNodes: NodeLinkTagNode[];
  quoteNodes: NodeLinkQuoteNode[];
  edges: NodeLinkEdge[];
};

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}

export function nodeLinkTagsForAnnotation(
  annotation: SavedAnnotation,
): string[] {
  return uniqueSorted(
    (annotation.tags ?? [])
      .map(tag => tag.trim())
      .filter(tag => tag && !SYSTEM_TAGS.has(tag)),
  );
}

function quoteTextForAnnotation(annotation: SavedAnnotation): string | null {
  const quote = annotationQuote(annotation)?.trim();
  if (quote) {
    return quote;
  }

  const description = annotationDescription(annotation)?.trim();
  return description || null;
}

export function buildNodeLinkGraph(
  annotations: SavedAnnotation[],
  { uris = [] }: { uris?: string[] } = {},
): NodeLinkGraph {
  const uriSet = new Set(uris);
  const tagAnnotationIds = new Map<string, Set<string>>();
  const quoteNodes: NodeLinkQuoteNode[] = [];
  const edges: NodeLinkEdge[] = [];

  for (const annotation of annotations) {
    if (
      isReply(annotation) ||
      annotation.hidden ||
      (uriSet.size > 0 && !uriSet.has(annotation.uri))
    ) {
      continue;
    }

    const tags = nodeLinkTagsForAnnotation(annotation);
    const quote = quoteTextForAnnotation(annotation);
    if (!tags.length || !quote) {
      continue;
    }

    const quoteNodeId = `quote:${annotation.id}`;
    quoteNodes.push({
      id: quoteNodeId,
      kind: 'quote',
      annotationId: annotation.id,
      quote,
      tags,
    });

    for (const tag of tags) {
      const tagNodeId = `tag:${tag}`;
      let annotationIds = tagAnnotationIds.get(tag);
      if (!annotationIds) {
        annotationIds = new Set();
        tagAnnotationIds.set(tag, annotationIds);
      }
      annotationIds.add(annotation.id);
      edges.push({
        id: `${tagNodeId}->${quoteNodeId}`,
        source: tagNodeId,
        target: quoteNodeId,
        annotationId: annotation.id,
        tag,
      });
    }
  }

  const tagNodes = [...tagAnnotationIds.entries()]
    .map(([tag, annotationIds]) => ({
      id: `tag:${tag}`,
      kind: 'tag' as const,
      tag,
      annotationIds: [...annotationIds],
    }))
    .sort((a, b) => {
      const countDelta = b.annotationIds.length - a.annotationIds.length;
      return (
        countDelta ||
        a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' })
      );
    });

  quoteNodes.sort((a, b) => {
    const firstTag = a.tags[0]?.localeCompare(b.tags[0] ?? '', undefined, {
      sensitivity: 'base',
    });
    return (
      firstTag ||
      a.quote.localeCompare(b.quote, undefined, { sensitivity: 'base' })
    );
  });

  return { tagNodes, quoteNodes, edges };
}
