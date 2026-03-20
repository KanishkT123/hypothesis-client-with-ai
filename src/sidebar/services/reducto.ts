import Reducto from 'reductoai';

export type ReductoSearchRequest = {
  candidateURIs: string[];
  query: string;
  apiKey: string;
  //schemaTag: string;
};


export type ReductoSearchResult = {
  answer: Reducto.V3ExtractResponse;
};

export class ReductoService {
  firstPDFURI(candidateURIs: string[]): string | null {
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
    const { query, candidateURIs, apiKey } = request;
    const documentURL = this.firstPDFURI(candidateURIs);
    if (!documentURL) {
      throw new Error('No PDF URL found in candidateURIs');
    }

    const reducto = new Reducto({
      apiKey: apiKey,
    });

    // This seems to be over-nested but for now it's what the API seems to want.
    const schema = {
      type: 'object',
      properties: {
        quotes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Verbatim quote from the document matching user query.'
              },
            },
          },
        },
      },
    };

    console.log('[ReductoService] query:', query);
    console.log('[ReductoService] candidateURIs:', candidateURIs);
    console.log('[ReductoService] documentURL:', documentURL);
    console.log('[ReductoService] apiKey:', apiKey);
    //console.log('[ReductoService] schemaTag:', schemaTag);
    // Temporary stub response so submit does not throw.
    //return { answer: 'Reducto debug stub response' }; //TODO: replace with actual Reducto response
    // const result = await reducto.search(documentURL, query, { schema });
    // console.log('[ReductoService] result:', result);
    // return result;

    console.log('[Reducto] start call', { documentURL, query });
    const startedAt = Date.now();
    try {
      const result = await reducto.extract.run({
        input: documentURL,
        instructions: {
          schema: schema,
          system_prompt: `Extract a list of verbatim quotes matching this query, iterating until all matching quotes are found: ${query}` 
          //TODO: ask for empty result rather than hallucanating
        },
        settings: {
          alpha: {
            deep_extract: true
          }
        } as any
      });
    
      console.log('[Reducto] success', {
        elapsedMs: Date.now() - startedAt,
        result,
      });
      console.log('[ReductoService] result:', result);

      if ('result' in result) {
        const quotes = (result.result as any[])[0].quotes;
        console.log(quotes);
      } else {
        console.error('[ReductoService] Error:', result);
        throw new Error('Failed to extract quotes from document');
      }
      return { answer: result }; 
    } catch (error) {
      console.error('[ReductoService] Error:', {
        elapsedMs: Date.now() - startedAt,
        error,
      });
      throw new Error('Failed to extract quotes from document');
    }
  }
}
