export type ReductoSearchRequest = {
  candidateURIs: string[];
  query: string;
};

//TODO: check this result formatting etc. against the actual API response
export type ReductoSearchResult = {
  answer: string;
  citations?: Array<{
    text?: string;
    page?: number;
    url?: string;
  }>;
};

export class ReductoService {
  private _firstPDFURI(candidateURIs: string[]): string | null {
    for (const uri of candidateURIs) {
      if (uri.toLowerCase().endsWith('.pdf')) {
        return uri;
      }
    }
    return null;
  }

  /**
   * Search a document with a free-text query.
   *
   * This is intentionally a stub first step: define contract now,
   * implement transport/auth in a later step.
   */
  async AISearchDocument(
    request: ReductoSearchRequest,
  ): Promise<ReductoSearchResult> {
    const { query, candidateURIs } = request;
    const documentURL = this._firstPDFURI(candidateURIs);

    console.log('[ReductoService] query:', query);
    console.log('[ReductoService] candidateURIs:', candidateURIs);
    console.log('[ReductoService] documentURL:', documentURL);
    // Temporary stub response so submit does not throw.
    return { answer: 'Reducto debug stub response' }; //TODO: replace with actual Reducto response
  }
}
