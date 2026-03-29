import {
  abortAllClaudeRuns,
  getActiveClaudeRunCount,
  registerClaudeRun,
} from '../ai-search-claude-runs';

describe('ai-search-claude-runs', () => {
  afterEach(() => {
    abortAllClaudeRuns();
  });

  it('registerClaudeRun adds an active run and finish removes it', () => {
    assert.equal(getActiveClaudeRunCount(), 0);

    const { signal, finish } = registerClaudeRun();
    assert.equal(getActiveClaudeRunCount(), 1);
    assert.equal(signal.aborted, false);

    finish();
    assert.equal(getActiveClaudeRunCount(), 0);
  });

  it('abortAllClaudeRuns aborts the signal and clears runs', () => {
    const { signal, finish } = registerClaudeRun();
    assert.equal(getActiveClaudeRunCount(), 1);

    abortAllClaudeRuns();

    assert.equal(signal.aborted, true);
    assert.equal(getActiveClaudeRunCount(), 0);
    finish(); // no-op if already cleared
  });
});
