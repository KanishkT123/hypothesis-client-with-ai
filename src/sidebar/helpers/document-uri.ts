import type { SavedAnnotation } from '../../types/api';
import type { SidebarStore } from '../store';

/**
 * URI reported by the guest content frame (main or first frame).
 * Used for group API calls that must wait for frame registration.
 */
export function contentFrameUri(
  store: Pick<SidebarStore, 'mainFrame' | 'defaultContentFrame'>,
): string | null {
  return store.mainFrame()?.uri ?? store.defaultContentFrame()?.uri ?? null;
}

function preferredHttpUri(uris: string[]): string | null {
  return (
    uris.find(u => u.startsWith('http://') || u.startsWith('https://')) ??
    uris[0] ??
    null
  );
}

/**
 * Returns the canonical URI for the current document.
 *
 * Priority:
 *  1. contentFrameUri — mainFrame or defaultContentFrame from the guest.
 *  2. First HTTP(S) URI in searchUris() — for PDFs, searchUris()[0] is the
 *     fingerprint URN (urn:x-pdf:…), so we skip it and take the HTTP link.
 *  3. searchUris()[0] — last-resort fallback (e.g. URN-only documents).
 *  4. null when no frame information is available yet.
 */
export function currentDocumentUri(
  store: Pick<SidebarStore, 'mainFrame' | 'defaultContentFrame' | 'searchUris'>,
): string | null {
  const frameUri = contentFrameUri(store);
  if (frameUri) {
    return frameUri;
  }
  return preferredHttpUri(store.searchUris());
}

/** All URIs Hypothesis associates with the current document. */
export function documentUriAliases(
  store: Pick<SidebarStore, 'searchUris'>,
): readonly string[] {
  return store.searchUris();
}

/**
 * True when `uri` refers to the same document as `canonicalUri`.
 * Strict equality, or both values appear in `aliases` (e.g. URN + HTTPS).
 */
export function documentUriMatches(
  uri: string,
  canonicalUri: string | null | undefined,
  aliases: readonly string[] = [],
): boolean {
  if (!canonicalUri) {
    return false;
  }
  if (uri === canonicalUri) {
    return true;
  }
  if (aliases.length === 0) {
    return false;
  }
  const aliasSet = new Set(aliases);
  return aliasSet.has(uri) && aliasSet.has(canonicalUri);
}

/** Saved annotations on the current document for a group. */
export function filterSavedAnnotationsForDocument(
  annotations: SavedAnnotation[],
  groupId: string,
  aliases: readonly string[],
): SavedAnnotation[] {
  const uriSet = new Set(aliases);
  return annotations.filter(
    ann => ann.group === groupId && uriSet.has(ann.uri),
  );
}

/**
 * Resolve the document URI used when creating Public tag-inventory rows.
 * Prefers `currentDocumentUri(store)`; otherwise applies the same HTTP-first
 * fallback as `currentDocumentUri` to explicit `candidateUris`.
 */
export function resolveDocumentUriFromCandidates(
  store: Pick<SidebarStore, 'mainFrame' | 'defaultContentFrame' | 'searchUris'>,
  candidateUris?: string[],
): string | null {
  const fromStore = currentDocumentUri(store);
  if (fromStore) {
    return fromStore;
  }
  if (candidateUris) {
    return preferredHttpUri(candidateUris);
  }
  return null;
}
