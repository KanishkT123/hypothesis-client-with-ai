import type { Annotation } from '../../types/api';
import {
  NODE_LINK_STATE_TAG,
  emptyNodeLinkState,
  isNodeLinkStateAnnotation,
  nodeLinkStateUri,
  parseNodeLinkStateText,
  stateFromNodeLinkPayload,
} from '../node-link/graph-state';
import type { NodeLinkSemanticState } from '../node-link/graph-state';
import type { APIService } from './api';

export type NodeLinkStateLoadResult = {
  status: 'loaded' | 'missing' | 'invalid';
  state: NodeLinkSemanticState;
  annotationId: string | null;
  stateUri: string;
  message?: string;
};

/**
 * Load node-link semantic state from the Hypothesis API.
 *
 * The extension/client should not use the local workbench server or API tokens.
 * This service reuses the normal OAuth-backed `APIService` so the node-link
 * sidebar panel sees the same authenticated group state as annotations.
 */
// @inject
export class NodeLinkStateService {
  private _api: APIService;

  constructor(api: APIService) {
    this._api = api;
  }

  async loadState(groupId: string): Promise<NodeLinkStateLoadResult> {
    const stateUri = nodeLinkStateUri(groupId);
    const result = await this._api.search({
      group: groupId,
      uri: stateUri,
      tag: NODE_LINK_STATE_TAG,
      limit: 10,
      sort: 'updated',
      order: 'desc',
    });
    const annotation = newestStateAnnotation(result.rows || []);

    if (!annotation) {
      return {
        status: 'missing',
        state: emptyNodeLinkState({ selectedGroupId: groupId }),
        annotationId: null,
        stateUri,
        message: 'No node-link state has been saved for this group yet.',
      };
    }

    try {
      const payload = parseNodeLinkStateText(annotation.text || '');
      return {
        status: 'loaded',
        state: stateFromNodeLinkPayload(payload, { groupId }),
        annotationId: annotation.id || null,
        stateUri,
      };
    } catch (err) {
      return {
        status: 'invalid',
        state: emptyNodeLinkState({ selectedGroupId: groupId }),
        annotationId: annotation.id || null,
        stateUri,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function newestStateAnnotation(annotations: Annotation[]) {
  return (
    annotations
      .filter(isNodeLinkStateAnnotation)
      .sort((a, b) =>
        String(b.updated || b.created || '').localeCompare(
          String(a.updated || a.created || ''),
        ),
      )[0] || null
  );
}
