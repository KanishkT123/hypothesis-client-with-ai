import Anthropic from '@anthropic-ai/sdk';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {z} from 'zod';

const PassageSchema = z.object({
  text: z
    .string()
    .describe('Verbatim or closely paraphrased passage from the paper.'),
  section: z
    .string()
    .optional()
    .describe(
      'Section of the paper where this passage appears, if identifiable.',
    ),
});

const PassagesSchema = z.array(PassageSchema);

function messageFromUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return '';
}

function isNetworkTransportError(error: unknown): boolean {
  const msg = messageFromUnknownError(error);
  return /ERR_NETWORK_CHANGED|Connection error|Failed to fetch|NetworkError/i.test(
    msg,
  );
}

export type ClaudeSearchRequest = {
  documentUrl: string;
  query: string;
  apiKey: string;
  /** When aborted, the request should be cancelled; callers must skip post-Claude work. */
  signal?: AbortSignal;
};

// Match the shape that AISearchPanel expects: answer.result[0].quotes
export type ClaudeSearchResult = {
  answer: { result: [{ quotes: { text: string }[] }] };
};

export class ClaudeService {
  /**
   * Search a document with a free-text query using Claude's native document support.
   * Returns data in the same shape as ReductoService so callers don't need to change.
   */
  async AISearchDocument(
    request: ClaudeSearchRequest,
  ): Promise<ClaudeSearchResult> {
    const {query, documentUrl, apiKey, signal} = request;
    if (!documentUrl) {
      throw new Error('No document URL provided');
    }

    const client = new Anthropic({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true,
    });

    console.log('[ClaudeService] start call', {documentUrl, query});
    const startedAt = Date.now();
    try {
      const message = await client.messages.parse(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          system:
            'You return verbatim quotes from the document at hand that answers or otherwise fulfills the user query.',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: {type: 'url', url: documentUrl},
                  cache_control: {type: 'ephemeral'},
                } as any,
                {
                  type: 'text',
                  text: query,
                },
              ],
            },
          ],
          output_config: {
            format: zodOutputFormat(PassagesSchema),
          },
        },
        signal ? {signal} : undefined,
      );

      console.log('[ClaudeService] success', {
        elapsedMs: Date.now() - startedAt,
      });

      const passages = message.parsed_output;
      if (!passages) {
        throw new Error('Claude returned no structured output');
      }
      console.log('[ClaudeService] parsed quotes:', passages);

      // Wrap in the Reducto-compatible shape: { result: [{ quotes: [...] }] }
      const quotes = passages.map(p => ({text: p.text}));
      return {answer: {result: [{quotes}]}};
    } catch (error: unknown) {
      const aborted =
        signal?.aborted ||
        (error instanceof Error && error.name === 'AbortError');
      if (aborted) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }
        const abortErr = new Error('Aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      console.error('[ClaudeService] Error:', {
        elapsedMs: Date.now() - startedAt,
        error,
      });
      if (isNetworkTransportError(error)) {
        throw new Error(
          'Network connection changed while contacting Claude. Check your internet or VPN and try again.',
        );
      }
      const details = messageFromUnknownError(error);
      if (details) {
        throw new Error(`Failed to extract quotes from document: ${details}`);
      }
      throw new Error('Failed to extract quotes from document.');
    }
  }
}