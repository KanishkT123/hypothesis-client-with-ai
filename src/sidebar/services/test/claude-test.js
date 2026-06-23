import { ClaudeService } from '../claude';

describe('ClaudeService', () => {
  it('throws when documentUri is empty', async () => {
    const claude = new ClaudeService();

    await assert.rejects(
      claude.AISearchDocument({
        documentUri: '',
        query: 'find methods',
        apiKey: 'test-key',
      }),
      /No document URL provided/,
    );
  });
});
