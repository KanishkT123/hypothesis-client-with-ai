import type { SidebarStore } from '../store';

/**
 * Returns the canonical URI for the current document.
 *
 * Priority:
 *  1. mainFrame().uri — set once the guest sends documentInfoChanged; this is
 *     the same URI Hypothesis stores on annotations and is always HTTP(S).
 *  2. First HTTP(S) URI in searchUris() — for PDFs, searchUris()[0] is the
 *     fingerprint URN (urn:x-pdf:…), so we skip it and take the HTTP link.
 *  3. searchUris()[0] — last-resort fallback (e.g. URN-only documents).
 *  4. null when no frame information is available yet.
 */
export function currentDocumentUri(
  store: Pick<SidebarStore, 'mainFrame' | 'searchUris'>,
): string | null {
  const mainUri = store.mainFrame()?.uri;
  if (mainUri) {
    return mainUri;
  }
  const uris = store.searchUris();
  return (
    uris.find(u => u.startsWith('http://') || u.startsWith('https://')) ??
    uris[0] ??
    null
  );
}
