import { ClaudeService } from '../claude';

describe('ClaudeService', () => {
  it('throws when documentUrl is empty', async () => {
    const claude = new ClaudeService();

    await assert.rejects(
      () =>
        claude.AISearchDocument({
          documentUrl: '',
          query: 'find methods',
          apiKey: 'test-key',
        }),
      /No document URL provided/,
    );
  });
});
